import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

if (process.platform !== 'win32') {
  console.error('This native smoke test requires Windows WebView2/CDP. On Linux, use npm run test:e2e for browser tests; native WebKitGTK validation is separate.');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map(process.argv.slice(2).map(value => {
  const separator = value.indexOf('=');
  return [value.slice(0, separator), value.slice(separator + 1)];
}));
const port = Number(args.get('--port') ?? 9223);
const configuration = args.get('--configuration') ?? 'debug';
assert.ok(['debug', 'release'].includes(configuration), 'Invalid build configuration');
const expectedOrigin = configuration === 'release' ? /^(?:https?:\/\/tauri\.localhost|tauri:\/\/localhost)(?:\/|$)/ : /^http:\/\/127\.0\.0\.1:1420\//;
const artifactName = configuration === 'release' ? 'native-release' : 'native';
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Invalid CDP port');
const output = path.join(root, 'test-results-native', configuration);
const report = { runtime: 'tauri-native-webview2', configuration, timestamp: new Date().toISOString(), processId: args.get('--pid') ?? null, checks: [] };
let browser;
let page;
let ownsSimulation = false;
let exportDirectory;
let exportedLogPath;
const errors = [];

async function invoke(command, values = {}) {
  const result = await page.evaluate(async ({ command, values }) => {
    if (!window.__TAURI_INTERNALS__?.invoke) throw new Error('Native Tauri IPC is unavailable');
    try {
      return { ok: true, value: await window.__TAURI_INTERNALS__.invoke(command, values) };
    } catch (error) {
      return { ok: false, error };
    }
  }, { command, values });
  if (!result.ok) throw result.error;
  return result.value;
}

async function waitSnapshot(predicate, label, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await invoke('get_snapshot');
    if (predicate(snapshot)) return snapshot;
    await page.waitForTimeout(35);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function execute(command, parameters = [], extras = {}) {
  const result = await invoke('execute_command', { request: { command, parameters, ...extras } });
  assert.equal(result.command, command, 'Native result must identify the request command');
  assert.equal(result.status, 0, result.message);
  return result;
}

async function waitWindowState(command, expected, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await invoke(`plugin:window|${command}`, { label: 'main' }) === expected) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function assertTopbarLayout() {
  const topbar = page.locator('.topbar');
  const controls = topbar.getByRole('group', { name: '窗口控制', exact: true });
  const themeButton = topbar.getByRole('button', { name: /^切换到(日间|夜间)主题$/ });
  await controls.waitFor();
  await themeButton.waitFor();
  assert.equal(await page.locator('.statusbar').count(), 0, 'No bottom status bar may remain');
  const headerRect = await topbar.boundingBox();
  const controlsRect = await controls.boundingBox();
  const themeRect = await themeButton.boundingBox();
  assert.ok(headerRect && controlsRect && themeRect, 'Topbar controls must have visible bounds');
  assert.equal(headerRect.y, 0, 'Window controls must be in the top bar');
  assert.ok(controlsRect.x >= themeRect.x + themeRect.width, 'Window controls must be beside the theme button');
  assert.ok(controlsRect.y >= headerRect.y && controlsRect.y + controlsRect.height <= headerRect.y + headerRect.height, 'Window controls must fit inside the top bar');
  assert.ok(controlsRect.x + controlsRect.width <= headerRect.x + headerRect.width, 'Window controls must fit within the native viewport');
  assert.ok(Math.abs(controlsRect.y + controlsRect.height / 2 - (themeRect.y + themeRect.height / 2)) <= 1, 'Window controls and theme button must share one horizontal row');
}

async function assertAppearance(theme, mode) {
  await page.locator(`html[data-theme="${theme}"]`).waitFor();
  const label = mode === 'day' ? '切换到夜间主题' : '切换到日间主题';
  const toggle = page.locator('.topbar').getByRole('button', { name: label, exact: true });
  await toggle.waitFor();
  assert.equal(await page.locator('html').evaluate(element => getComputedStyle(element).colorScheme), mode === 'day' ? 'light' : 'dark', 'Native color scheme must match the selected theme group');
  assert.equal(await toggle.getAttribute('title'), label, 'Theme tooltip must describe the next appearance mode');
  await toggle.locator(mode === 'day' ? 'svg.lucide-moon' : 'svg.lucide-sun').waitFor();
}

try {
  await mkdir(output, { recursive: true });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 30000 });
  const deadline = Date.now() + 30000;
  while (!page && Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const candidate of context.pages()) {
        if (expectedOrigin.test(candidate.url()) && await candidate.evaluate(() => Boolean(window.__TAURI_INTERNALS__?.invoke)).catch(() => false)) {
          page = candidate;
          break;
        }
      }
      if (page) break;
    }
    if (!page) await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.ok(page, 'No Tauri WebView was found on the dedicated CDP endpoint');
  assert.match(page.url(), expectedOrigin, 'Unexpected application origin');
  report.url = page.url();
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '读卡工作台', exact: true }).waitFor();
  const initial = await invoke('get_snapshot');
  assert.equal(initial.connection.connected, false, 'Refusing to modify an existing device session');
  report.checks.push('Real Tauri IPC detected; application starts disconnected');

  assert.equal(await invoke('plugin:window|is_decorated', { label: 'main' }), false, 'Native title bar must be hidden');
  const controls = page.locator('.topbar').getByRole('group', { name: '窗口控制', exact: true });
  await controls.waitFor();
  await assertTopbarLayout();
  await controls.getByRole('button', { name: '最大化窗口', exact: true }).click();
  await waitWindowState('is_maximized', true, 'native maximization');
  await controls.getByRole('button', { name: '还原窗口', exact: true }).waitFor();
  await assertTopbarLayout();
  await page.screenshot({ path: path.join(output, `${artifactName}-maximized.png`), fullPage: true });
  await controls.getByRole('button', { name: '还原窗口', exact: true }).click();
  await waitWindowState('is_maximized', false, 'native restoration');
  await assertTopbarLayout();
  await controls.getByRole('button', { name: '最小化窗口', exact: true }).click();
  await waitWindowState('is_minimized', true, 'native minimization');
  await invoke('plugin:window|unminimize', { label: 'main' });
  await waitWindowState('is_minimized', false, 'restoring minimized native window');
  await page.getByTitle('拖动窗口', { exact: true }).waitFor();
  report.checks.push('Undecorated native window has controls beside the theme button in one topbar row, no bottom statusbar, and working maximize, restore and minimize buttons');

  const navigation = page.getByRole('navigation', { name: '主导航' });
  await navigation.getByRole('button', { name: '外观设置', exact: true }).click();
  await page.getByRole('heading', { name: '外观设置', level: 1, exact: true }).waitFor();
  await page.getByRole('button', { name: '苔原微光', exact: true }).click();
  await assertAppearance('emerald', 'day');
  await page.getByRole('button', { name: '切换到夜间主题', exact: true }).click();
  await assertAppearance('business', 'night');
  await page.getByRole('button', { name: '切换到日间主题', exact: true }).click();
  await assertAppearance('emerald', 'day');
  await page.getByRole('button', { name: '高对比', exact: true }).click();
  await assertAppearance('black', 'night');
  await page.getByRole('button', { name: '切换到日间主题', exact: true }).click();
  await assertAppearance('emerald', 'day');
  await page.getByRole('button', { name: '切换到夜间主题', exact: true }).click();
  await assertAppearance('black', 'night');
  report.checks.push('Native WebView2 day/night theme roundtrips preserve forest and high contrast, with matching data-theme, color scheme, icon and dynamic button label');

  await page.waitForFunction(() => {
    const prefs = JSON.parse(localStorage.getItem('df01.preferences') ?? '{}');
    return prefs.theme === 'contrast' && prefs.dayTheme === 'forest' && prefs.nightTheme === 'contrast';
  }, undefined, { timeout: 5000 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.getByRole('heading', { name: '读卡工作台', level: 1, exact: true }).waitFor();
  await assertAppearance('black', 'night');
  const savedAppearance = await page.evaluate(() => {
    const { theme, dayTheme, nightTheme } = JSON.parse(localStorage.getItem('df01.preferences') ?? '{}');
    return { theme, dayTheme, nightTheme };
  });
  assert.deepEqual(savedAppearance, { theme: 'contrast', dayTheme: 'forest', nightTheme: 'contrast' }, 'Native reload must preserve both remembered theme groups');
  assert.equal((await invoke('get_snapshot')).connection.connected, false, 'Theme verification must finish before any device connection');
  await navigation.getByRole('button', { name: '外观设置', exact: true }).click();
  await page.getByRole('button', { name: '琥珀标本', exact: true }).click();
  await assertAppearance('corporate', 'day');
  await navigation.getByRole('button', { name: '读卡工作台', exact: true }).click();
  await page.getByRole('heading', { name: '读卡工作台', level: 1, exact: true }).waitFor();
  await assertTopbarLayout();
  report.checks.push('Native reload preserves high contrast and both theme preferences; light workbench restored before protocol verification and screenshots');

  const ports = await invoke('list_ports');
  assert.ok(Array.isArray(ports));
  for (const item of ports) {
    assert.equal(typeof item.name, 'string');
    assert.equal(typeof item.kind, 'string');
  }
  report.availablePortCount = ports.length;
  report.availablePorts = ports.map(item => item.name);
  const serialSelect = page.getByRole('combobox', { name: '串口', exact: true });
  const expectedPorts = [...new Set(report.availablePorts)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const [index, name] of expectedPorts.entries()) {
    await serialSelect.click();
    const options = page.getByRole('listbox', { name: '可用串口' }).getByRole('option');
    await expect(options).toHaveCount(expectedPorts.length + 1);
    await expect(options.nth(index + 1)).toContainText(name);
    await options.nth(index + 1).click();
    await expect(serialSelect).toContainText(name);
  }
  report.checks.push('Native serial discovery and complete naturally sorted dropdown verified; every discovered port selected without opening hardware connections');

  await page.getByRole('combobox', { name: '连接方式', exact: true }).selectOption('simulation');
  const connection = await invoke('connect_device', { config: { port: '', baudRate: 115200, address: 0, timeoutMs: 1000, simulation: true, profile: 'current' } });
  ownsSimulation = true;
  assert.equal(connection.connected, true);
  assert.equal(connection.simulation, true);
  assert.equal(connection.profile, 'current');
  const synchronized = await invoke('get_snapshot');
  assert.equal(synchronized.configuration.moduleId, 0);
  assert.equal(synchronized.configuration.baudRate, 115200);
  assert.equal(synchronized.configuration.resetMs, 0);
  assert.equal(synchronized.configuration.antennaGain, 7);
  assert.equal(synchronized.logs.filter(log => log.direction === 'tx' && log.command === 0x31).length, 1, 'Connection must synchronize configuration exactly once');
  report.checks.push('Connection synchronizes 31/B1 configuration at fixed 115200 baud');
  await expect(page).toHaveTitle('果蝇1号 · DF-01');
  await expect(page.getByRole('button', { name: '断开连接', exact: true })).toBeVisible();
  // Finish the default connection-time report before measuring a new mode's cue.
  await page.getByLabel('工作台自动模式').selectOption('1');
  await page.getByRole('button', { name: '应用模式', exact: true }).click();
  await expect(page.locator('.quick-mode .control-heading')).toContainText('关闭自动读取');
  await page.waitForTimeout(650);
  await page.evaluate(() => {
    window.nativeAudioVoices = 0;
    const createOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      window.nativeAudioVoices++;
      return createOscillator.call(this);
    };
  });
  await page.getByLabel('工作台自动模式').selectOption('2');
  await page.getByLabel('工作台目标块').fill('1');
  await page.getByRole('button', { name: '应用模式', exact: true }).click();
  await expect(page.locator('.latest-data')).toContainText('DF-01 FRUITFLY');
  await expect.poll(() => page.evaluate(() => window.nativeAudioVoices)).toBe(1);
  await page.getByRole('button', { name: '全局静音', exact: true }).click();
  const beforeMutedReport = Math.max(...(await invoke('get_snapshot')).logs.map(log => log.id));
  await page.getByRole('button', { name: '应用模式', exact: true }).click();
  await waitSnapshot(snapshot => snapshot.logs.some(log => log.id > beforeMutedReport && log.message.startsWith('主动上报 · ') && log.level === 'success'), 'automatic report while muted');
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => window.nativeAudioVoices), 1, 'Native automatic reports must stay silent when globally muted');
  await page.getByRole('button', { name: '取消全局静音', exact: true }).click();
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => window.nativeAudioVoices), 1, 'Unmuting must not replay old reports');
  await page.getByRole('button', { name: '应用模式', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.nativeAudioVoices)).toBe(2);
  report.checks.push('Native automatic block reports play a short audio cue; global mute suppresses new report sounds and unmuting does not replay history');
  const gain = page.getByRole('slider', { name: '工作台天线增益', exact: true });
  await gain.focus();
  await gain.press('Home');
  const gainOrigin = await invoke('plugin:window|outer_position', { label: 'main' });
  await page.evaluate(() => {
    window.gainPreviousMotion = document.documentElement.dataset.motion;
    document.documentElement.dataset.motion = 'full';
    window.gainPositionSamples = (async () => {
      const positions = [];
      const deadline = Date.now() + 1600;
      while (Date.now() < deadline) {
        positions.push(await window.__TAURI_INTERNALS__.invoke('plugin:window|outer_position', { label: 'main' }));
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return positions;
    })();
  });
  await gain.focus();
  await gain.press('End');
  await expect(page.locator('.gain-easter-egg')).toHaveText('白眼果蝇抖擞精神！');
  await expect(gain).toBeFocused();
  await expect(page.locator('.rf-control')).toContainText('已保存 48 dB');
  const gainPositions = await page.evaluate(() => window.gainPositionSamples);
  assert.ok(gainPositions.some(position => position.x !== gainOrigin.x || position.y !== gainOrigin.y), 'The actual native window must move during the celebration');
  assert.deepEqual(await invoke('plugin:window|outer_position', { label: 'main' }), gainOrigin, 'The native window must return to its original position');
  await page.evaluate(() => { document.documentElement.dataset.motion = window.gainPreviousMotion; });
  report.checks.push('Maximum gain physically shakes the entire native window and restores its original position');
  await page.screenshot({ path: path.join(output, `${artifactName}-white-eye.png`), fullPage: false });
  await page.getByRole('button', { name: '关闭彩蛋', exact: true }).click();
  report.checks.push('Maximum-gain white-eyed fruit fly easter egg appears without changing saved gain or stealing focus and can be dismissed');
  await page.getByRole('button', { name: '保存增益', exact: true }).click();
  await expect(page.locator('.rf-control')).toContainText('已保存 48 dB');
  await page.getByLabel('工作台防重读时长').fill('1001');
  await page.getByRole('button', { name: '保存时长', exact: true }).click();
  await expect(page.locator('.reset-control')).toContainText('已保存 1001 ms');
  await page.getByRole('button', { name: '无限期', exact: true }).click();
  await page.getByRole('button', { name: '保存时长', exact: true }).click();
  await expect(page.locator('.reset-control')).toContainText('已保存 无限期');
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  for (const selector of ['.quick-mode', '.rf-control', '.reset-control', '.latest-data', '.traffic-workspace']) {
    const bounds = await page.locator(selector).boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1, `${selector} must fit in the native first screen`);
  }
  const brandCdp = await page.context().newCDPSession(page);
  try {
    await brandCdp.send('DOM.enable');
    await brandCdp.send('CSS.enable');
    const { root: documentRoot } = await brandCdp.send('DOM.getDocument');
    const { nodeId } = await brandCdp.send('DOM.querySelector', { nodeId: documentRoot.nodeId, selector: '.brand strong' });
    const { fonts } = await brandCdp.send('CSS.getPlatformFontsForNode', { nodeId });
    assert.equal(fonts.filter(font => font.glyphCount > 0).length, 1, 'The entire brand must use one rendered typeface');
    assert.equal(fonts[0].glyphCount, 4);
    report.brandFonts = fonts;
  } finally {
    await brandCdp.detach();
  }
  report.trafficBounds = await page.locator('.traffic-workspace').evaluate(panel => {
    const bounds = selector => panel.querySelector(selector).getBoundingClientRect().toJSON();
    return { toolbar: bounds('.traffic-toolbar'), input: bounds('.search-input input'), icon: bounds('.search-input svg'), columns: bounds('.traffic-columns') };
  });
  assert.ok(report.trafficBounds.input.bottom <= report.trafficBounds.columns.top, 'Search input must not obscure communication column labels');
  assert.ok(report.trafficBounds.input.bottom <= report.trafficBounds.toolbar.bottom + 1, 'Toolbar must contain its search input');
  assert.ok(Math.abs((report.trafficBounds.icon.top + report.trafficBounds.icon.bottom - report.trafficBounds.input.top - report.trafficBounds.input.bottom) / 2) <= 1, 'Search icon must be vertically centered');
  report.checks.push('All four brand characters use one rendered typeface; communication input stays inside the toolbar, clears the column labels and centers its icon');
  const closeWorkbenchNotice = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await closeWorkbenchNotice.isVisible()) await closeWorkbenchNotice.click();
  await page.screenshot({ path: path.join(output, `${artifactName}-df01-workbench.png`), fullPage: false });
  report.checks.push('DF-01 branding, first-screen mode/gain/reset UI saves and received-block decoding verified through native IPC');
  await execute(0x2e, [1, 11, 1, 0, 0, 0, 1, 0x23, 0x12, 0x54]);
  const preview = await invoke('preview_command', { request: { command: 0x10, parameters: [] } });
  assert.deepEqual(preview, { hex: '7F 03 00 10 13', length: 5 });
  const first = await execute(0x10);
  assert.equal(first.card.uidHex, 'ABAF45E0');
  assert.equal(first.card.uidRawHex, 'E0 45 AF AB');
  assert.equal(first.card.atqaHex, '04 00');
  assert.equal(first.card.uidDecimal, String(0xabaf45e0));
  assert.equal(first.card.data, null);
  assert.equal(first.card.block, null);
  assert.ok(Math.abs(first.card.timestamp - Date.now()) < 10000, 'Timestamp must be Unix milliseconds');
  report.checks.push('Simulator connection, manual frame preview, UID and timestamp verified');

  const data = Array.from({ length: 16 }, (_, index) => index % 3 === 0 ? 0x7f : index);
  await execute(0x12, [1, ...data]);
  const read = await execute(0x11, [1]);
  assert.deepEqual(read.card.data, data);
  assert.equal(read.card.block, 1);
  assert.deepEqual(read.data.slice(7), data);
  report.checks.push('Native write/read roundtrip preserves escaped 7F bytes');

  const keys = [...Array(12).fill(0x3a), 0, 3, 8, 5, 2, 7];
  const keyPreview = await invoke('preview_command', { request: { command: 0x2b, parameters: keys } });
  assert.ok(!keyPreview.hex.includes('3A 3A'));
  await execute(0x2b, keys);
  await execute(0x31);
  const keySnapshot = await invoke('get_snapshot');
  assert.ok(keySnapshot.logs.filter(log => log.command === 0x2b).every(log => !log.hex.includes('3A 3A')));
  assert.deepEqual(keySnapshot.configuration.keyA, keys.slice(0, 6));
  assert.deepEqual(keySnapshot.configuration.keyB, keys.slice(6, 12));
  assert.ok(keySnapshot.logs.filter(log => log.command === 0xb1).every(log => !log.hex.includes('3A 3A')));
  report.checks.push('Native key preview, configuration synchronization and logs preserve key redaction');

  const resetPreview = await invoke('preview_command', { request: { command: 0x2f, parameters: [0xe8, 3] } });
  assert.equal(resetPreview.hex, '7F 05 00 2F E8 03 C1');
  await execute(0x2f, [100, 0]);
  await execute(0x30, [7]);
  await execute(0x31);
  const updatedConfiguration = (await invoke('get_snapshot')).configuration;
  assert.equal(updatedConfiguration.resetMs, 100);
  assert.equal(updatedConfiguration.antennaGain, 7);
  await execute(0x2d, [0x7f, 0x37, 0x21, 0x56]);
  assert.equal((await invoke('get_snapshot')).connection.address, 0x7f, 'Successful AD at the new ID must update the connection');
  await execute(0x31);
  assert.equal((await invoke('get_snapshot')).configuration.moduleId, 0x7f);
  await execute(0x2d, [0, 0x37, 0x21, 0x56]);
  report.checks.push('RESET duration, actual antenna gain, new-address AD acknowledgement and configuration readback verified');

  const txBeforeRejected = (await invoke('get_snapshot')).stats.tx;
  for (const command of [0x13, 0x14, 0x15, 0x16, 0xa0]) {
    let rejected;
    try { await invoke('execute_command', { request: { command, parameters: [] } }); } catch (error) { rejected = error; }
    assert.equal(rejected?.code, 'excluded_operation', `Command ${command.toString(16)} must be rejected`);
  }
  assert.equal((await invoke('get_snapshot')).stats.tx, txBeforeRejected);
  report.checks.push('Excluded identity and transaction commands never transmit');

  let rejectedBaud;
  try { await invoke('execute_command', { request: { command: 0x2c, parameters: [0, 0xc2, 1, 0, 0x98, 0x24, 0x31], byteOrder: 'little' } }); } catch (error) { rejectedBaud = error; }
  assert.ok(rejectedBaud, 'Baud-rate changes must be rejected');
  assert.equal((await invoke('get_snapshot')).stats.tx, txBeforeRejected);
  report.checks.push('Removed baud-rate command cannot transmit through native IPC');

  await invoke('set_simulation_card', { present: false });
  const pendingRead = invoke('execute_command', { request: { command: 0x10, parameters: [] } });
  await page.waitForTimeout(150);
  await invoke('set_simulation_card', { present: true });
  assert.equal((await pendingRead).status, 0);
  await execute(0x2f, [0, 0]);
  const rxBeforeMode = (await invoke('get_snapshot')).stats.rx;
  await execute(0x2e, [0, 10, 1, 0, 0, 0, 0, 0x23, 0x12, 0x54]);
  const reported = await waitSnapshot(snapshot => snapshot.stats.rx >= rxBeforeMode + 2, 'automatic UID report');
  assert.equal(reported.autoMode, 0);
  assert.equal(reported.autoBlock, 1);
  await invoke('set_simulation_card', { present: false });
  await page.waitForTimeout(50);
  await invoke('set_simulation_card', { present: true });
  await page.waitForTimeout(180);
  assert.equal((await invoke('get_snapshot')).stats.rx, reported.stats.rx, 'Same UID must remain deduplicated after removal');
  await invoke('simulate_next_card');
  await waitSnapshot(snapshot => snapshot.lastCard?.uidHex === 'DDCCBBAA', 'second UID automatic report');
  report.checks.push('No-card status and automatic UID deduplication verified');

  const beforeManualRead = (await invoke('get_snapshot')).stats.rx;
  await execute(0x10);
  await waitSnapshot(snapshot => snapshot.stats.rx >= beforeManualRead + 2, 'manual read clears matching UID deduplication');
  await execute(0x2f, [100, 0]);
  const timedRx = (await invoke('get_snapshot')).stats.rx;
  await waitSnapshot(snapshot => snapshot.stats.rx >= timedRx + 2, 'RESET timeout repeats a present UID');
  await execute(0x2f, [0, 0]);
  report.checks.push('Manual same-UID reads clear deduplication and finite RESET repeats the present card');

  await execute(0x2e, [2, 12, 1, 0, 0, 0, 0, 0x23, 0x12, 0x54]);
  await invoke('simulate_next_card');
  const automaticBlock = await waitSnapshot(snapshot => snapshot.lastCard?.uidHex === 'ABAF45E0' && snapshot.lastCard?.block === 1, 'automatic block report');
  assert.deepEqual(automaticBlock.lastCard.data, data);
  assert.equal(automaticBlock.autoMode, 2);
  await execute(0x2e, [1, 11, 1, 0, 0, 0, 0, 0x23, 0x12, 0x54]);
  const stoppedRx = (await invoke('get_snapshot')).stats.rx;
  await invoke('simulate_next_card');
  await page.waitForTimeout(180);
  assert.equal((await invoke('get_snapshot')).stats.rx, stoppedRx, 'Disabled automatic mode must not report a changed UID');
  report.checks.push('Automatic block data and disabling automatic mode verified');

  await page.getByRole('button', { name: '通信日志', exact: true }).click();
  await page.waitForTimeout(600);
  exportDirectory = await invoke('log_export_directory');
  const exportName = `df01-native-smoke-${args.get('--pid')}-${Date.now()}`;
  let webviewDownloads = 0;
  const countDownload = () => { webviewDownloads++; };
  page.on('download', countDownload);
  await page.getByRole('button', { name: '导出筛选日志', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: '导出通信日志', exact: true });
  await expect(exportDialog).toBeVisible();
  await expect(exportDialog).toHaveCSS('background-color', await page.locator('.logs-panel').evaluate(element => getComputedStyle(element).backgroundColor));
  await page.getByLabel('文件名', { exact: true }).fill(exportName);
  await page.screenshot({ path: path.join(output, `${artifactName}-log-export.png`) });
  await page.getByRole('button', { name: '保存日志', exact: true }).click();
  await expect(page.locator('.log-export-success')).toContainText('文件已保存');
  const candidatePath = await page.locator('.log-export-success p').innerText();
  assert.equal(path.dirname(candidatePath), path.resolve(exportDirectory));
  assert.equal(path.basename(candidatePath), `${exportName}.log`);
  exportedLogPath = candidatePath;
  const downloadArtifact = path.join(output, `testnative-${configuration}.log`);
  const downloadedText = await readFile(exportedLogPath, 'utf8');
  await writeFile(downloadArtifact, downloadedText);
  const recordCount = (downloadedText.match(/^\[/gm) ?? []).length;
  assert.ok(recordCount > 0, 'Saved log must contain timestamped records');
  assert.ok(downloadedText.includes('设备：模拟设备'));
  assert.ok(!downloadedText.includes('3A 3A'), 'Export exposed a loaded key');
  assert.equal(webviewDownloads, 0, 'Native export must not open the WebView download interface');
  page.off('download', countDownload);
  report.downloadFile = path.relative(root, downloadArtifact);
  report.exportedLogCount = recordCount;
  report.checks.push('Themed native log export saves UTF-8 .log text to Downloads with redacted keys and no WebView download interface');
  await page.getByRole('button', { name: '完成', exact: true }).click();

  await navigation.getByRole('button', { name: '数据块', exact: true }).click();
  const memoryPage = page.locator('main.memory-page');
  await memoryPage.waitFor();
  const memoryEditor = memoryPage.locator('.memory-block-section');
  const memoryHeading = memoryEditor.getByRole('heading', { name: '块 01', level: 2, exact: true });
  const memoryRead = memoryEditor.getByRole('button', { name: '读取块', exact: true });
  await memoryHeading.waitFor();
  await expect(memoryPage.getByRole('button', { name: '选择块 63', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(memoryPage.getByRole('button', { name: '读取扇区', exact: true })).toBeInViewport({ ratio: 1 });
  assert.ok(await memoryPage.evaluate(element => element.scrollHeight <= element.clientHeight + 1), 'Complete native memory workspace must fit the first screen');
  const memoryBounds = await memoryPage.boundingBox();
  const nativeViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(memoryBounds, 'Native memory workspace must have visible bounds');
  for (const [element, name] of [[memoryHeading, 'current block heading'], [memoryRead, 'block read button']]) {
    const bounds = await element.boundingBox();
    assert.ok(bounds, `Native ${name} must be visible`);
    assert.ok(bounds.x >= memoryBounds.x && bounds.x + bounds.width <= Math.min(memoryBounds.x + memoryBounds.width, nativeViewport.width), `Native ${name} must fit horizontally in the first memory view`);
    assert.ok(bounds.y >= memoryBounds.y && bounds.y + bounds.height <= Math.min(memoryBounds.y + memoryBounds.height, nativeViewport.height), `Native ${name} must be entirely visible without scrolling`);
  }
  assert.equal(await memoryEditor.locator('.byte-inspector .byte-grid').count(), 0, 'Compact native inspector must not repeat the raw byte grid');
  const beforeMemoryRead = await invoke('get_snapshot');
  await memoryRead.click();
  const memoryResult = await waitSnapshot(snapshot => snapshot.stats.rx > beforeMemoryRead.stats.rx && snapshot.lastCard?.block === 1 && snapshot.lastCard.timestamp > (beforeMemoryRead.lastCard?.timestamp ?? 0), 'native memory page block read');
  assert.equal(memoryResult.lastCard.data.length, 16, 'Native UI block read must return exactly 16 bytes');
  await page.waitForFunction(expected => {
    const editor = document.querySelector('.memory-block-section');
    if (!editor) return false;
    const bytes = [...editor.querySelectorAll('.hex-editor input')].map(input => Number.parseInt(input.value, 16));
    const read = [...editor.querySelectorAll('button')].find(button => button.textContent.trim() === '读取块');
    return read && !read.disabled && bytes.length === expected.length && bytes.every((byte, index) => byte === expected[index]);
  }, memoryResult.lastCard.data, { timeout: 5000 });
  const closeMemoryNotice = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await closeMemoryNotice.isVisible()) await closeMemoryNotice.click();
  const memoryScreenshot = path.join(output, `${artifactName}-memory.png`);
  await page.screenshot({ path: memoryScreenshot, fullPage: false, animations: 'disabled' });
  report.memoryScreenshot = path.relative(root, memoryScreenshot);
  report.checks.push('Native memory page shows the current block and read action in the first viewport, omits the duplicate byte grid, and displays all 16 response bytes after an actual UI block read');

  for (const [name, slug] of [['密钥管理', 'keys'], ['设备配置', 'device'], ['通信日志', 'logs']]) {
    await navigation.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.tool-panel').first()).toHaveCSS('border-radius', '8px');
    assert.ok(await page.locator('main').evaluate(element => element.scrollHeight <= element.clientHeight + 1), `Native ${name} must fit the first screen`);
    await page.screenshot({ path: path.join(output, `${artifactName}-${slug}.png`), fullPage: false });
  }
  const logScroll = page.locator('.logs-panel .log-table-wrap');
  assert.ok(await logScroll.evaluate(element => element.scrollHeight > element.clientHeight), 'Long native logs must scroll inside their panel');
  await logScroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(page.locator('.log-table th').first()).toBeInViewport({ ratio: 1 });
  report.checks.push('Key management, device settings and communication logs use consistent panels; controls fit the native first screen and long logs scroll internally with a visible header');

  await navigation.getByRole('button', { name: '外观设置', exact: true }).click();
  for (const name of ['琥珀标本', '夜航观测', '苔原微光', '高对比', '舒适', '紧凑']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
  await expect(page.getByLabel('动态效果', { exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.about-band')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.about-band')).toContainText('Mzee');
  await expect(page.locator('.about-band')).toContainText('xiemaths@outlook.com');
  await expect(page.locator('.about-band')).toContainText('上海玖驱科技有限公司');
  assert.ok(await page.locator('main').evaluate(element => element.scrollHeight <= element.clientHeight + 1), 'Complete native appearance page must fit the first screen');
  assert.ok(await page.locator('.about-band').evaluate(element => innerHeight - element.getBoundingClientRect().bottom <= 16), 'Native appearance content must fill the first screen down to the bottom gutter');
  await page.screenshot({ path: path.join(output, `${artifactName}-appearance.png`), fullPage: false });
  report.checks.push('Complete memory map, sector operations, four themes, density, motion and about information fit in the native first screen');

  await page.getByRole('button', { name: '读卡工作台', exact: true }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(output, `${artifactName}.png`), fullPage: true });
  assert.deepEqual(errors, [], 'Native window produced uncaught JavaScript errors');
  await invoke('disconnect_device');
  ownsSimulation = false;
  assert.equal((await invoke('get_snapshot')).connection.connected, false);
  report.checks.push('Native screenshot captured and simulator disconnected');
  await expect(page.getByRole('button', {name: '连接设备', exact: true})).toBeVisible();
  await page.getByLabel('模拟产品', {exact: true}).selectOption('1');
  await expect(navigation.getByRole('button', {name: '偷油婆扩展', exact: true})).toHaveCount(0);
  await page.getByRole('button', {name: '连接设备', exact: true}).click();
  ownsSimulation = true;
  const cockroachSnapshot = await waitSnapshot(snapshot => snapshot.connection.connected && snapshot.configuration?.productMode === 1, 'Cockroach B1 readback');
  assert.equal(cockroachSnapshot.configuration.autoMode, 3);
  await expect(page.getByRole('heading', {name: '偷油婆扩展', exact: true})).toBeVisible();
  await expect(page.locator('.brand-copy strong')).toHaveText('偷油婆一号');
  await page.getByLabel('语音读取块 / 页', {exact: true}).fill('8');
  await page.getByLabel('文本编码', {exact: true}).selectOption('5');
  await page.getByLabel('等待本条播报完成再发送下一条', {exact: false}).check();
  await page.getByRole('button', {name: '保存并开启语音', exact: true}).click();
  await waitSnapshot(snapshot => snapshot.configuration?.autoBlock === 8 && snapshot.configuration.autoInitialValue[0] === 5 && snapshot.configuration.autoInitialValue[1] === 1, 'native TTS acknowledgement');
  await execute(0x31);
  assert.deepEqual((await invoke('get_snapshot')).configuration.autoInitialValue, [5, 1, 0, 0]);
  await page.getByLabel('电机缓启动时间 (ms)', {exact: true}).fill('2000');
  await page.getByLabel('系统启动延时 (ms)', {exact: true}).fill('500');
  await page.getByRole('button', {name: '保存启动时序', exact: true}).click();
  await waitSnapshot(snapshot => snapshot.configuration?.rampMs === 2000 && snapshot.configuration.startupDelayMs === 500, 'native startup acknowledgement');
  await execute(0x31);
  const nativeCockroach = (await invoke('get_snapshot')).configuration;
  assert.equal(nativeCockroach.rampMs, 2000);
  assert.equal(nativeCockroach.startupDelayMs, 500);
  assert.equal(nativeCockroach.initialDutyPercent, 60);
  await page.getByLabel('初始占空比 (%)', {exact: true}).fill('65');
  await page.getByRole('button', {name: '保存初始占空比', exact: true}).click();
  await waitSnapshot(snapshot => snapshot.configuration?.initialDutyPercent === 65, 'native initial duty acknowledgement');
  await execute(0x31);
  assert.equal((await invoke('get_snapshot')).configuration.initialDutyPercent, 65);
  await page.getByRole('button', {name: '关闭语音自动读取', exact: true}).click();
  await waitSnapshot(snapshot => snapshot.configuration?.autoMode === 1, 'disable native voice mode');
  const beforeDirection = await invoke('get_snapshot');
  await expect(page.locator('.product-features')).not.toContainText(/PA5|PA7|GPIO/);
  assert.equal(await page.locator('.product-direction [title*="PA5"], .product-direction [title*="PA7"]').count(), 0);
  await page.getByRole('radio', {name: '正转', exact: true}).check();
  await page.getByRole('radio', {name: '反转', exact: true}).check();
  await expect(page.getByRole('radio', {name: '反转', exact: true})).toBeChecked();
  const afterDirection = await invoke('get_snapshot');
  assert.equal(afterDirection.stats.tx, beforeDirection.stats.tx);
  assert.deepEqual(afterDirection.configuration, beforeDirection.configuration);
  assert.equal(beforeDirection.configuration.motorDirection, 0);
  await page.getByRole('button', {name: '保存方向', exact: true}).click();
  await waitSnapshot(snapshot => snapshot.configuration?.motorDirection === 1, 'native motor direction acknowledgement');
  const directionReadback = await execute(0x31);
  assert.equal(directionReadback.data.length, 34);
  assert.equal(directionReadback.data[33], 1);
  await expect(page.getByText('已保存方向 · 反转', {exact: true})).toBeVisible();
  const directionSnapshot = await invoke('get_snapshot');
  assert.ok(directionSnapshot.logs.some(log => log.direction === 'tx' && log.command === 0x34));
  assert.ok(directionSnapshot.logs.some(log => log.direction === 'rx' && log.command === 0xb4));
  report.checks.push('Author credit is visible; initial duty saves through 33/B3; motor direction selection stays local until saved through 34/B4, then v15 31/B1 returns 34 parameters with direction at offset 33');
  await page.screenshot({path: path.join(output, `${artifactName}-cockroach.png`), fullPage: true});
  report.checks.push('Cockroach simulator selected through UI: real Rust 31/B1 readback reveals the product page; TTS 2E/AE and startup 32/B2 save and re-query correctly; voice mode can be disabled');
  await page.getByRole('button', {name: '断开连接', exact: true}).click();
  await expect(navigation.getByRole('button', {name: '偷油婆扩展', exact: true})).toHaveCount(0);
  await page.getByLabel('模拟产品', {exact: true}).selectOption('0');
  await page.getByRole('button', {name: '连接设备', exact: true}).click();
  await waitSnapshot(snapshot => snapshot.connection.connected && snapshot.configuration?.productMode === 0, 'return to Fruit Fly B1');
  await expect(page.locator('.brand-copy strong')).toHaveText('果蝇1号');
  await expect(navigation.getByRole('button', {name: '偷油婆扩展', exact: true})).toHaveCount(0);
  await invoke('disconnect_device');
  ownsSimulation = false;
  assert.deepEqual(errors, [], 'Product switching produced no uncaught JavaScript errors');
  report.checks.push('Native Cockroach disconnect hides extensions; reconnecting the Fruit Fly simulator restores the Fruit Fly workstation');
  const closed = page.waitForEvent('close', { timeout: 10000 });
  await Promise.all([
    closed,
    controls.getByRole('button', { name: '关闭窗口', exact: true }).click({ noWaitAfter: true }).catch(error => {
      if (!page.isClosed()) throw error;
    }),
  ]);
  report.checks.push('Topbar close button closed the actual native WebView');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
  if (page) await page.screenshot({ path: path.join(output, `${artifactName}-failure.png`), fullPage: true }).catch(() => {});
} finally {
  if (ownsSimulation && page) {
    const current = await invoke('get_snapshot').catch(() => null);
    if (current?.connection.connected && current.connection.simulation) await invoke('disconnect_device').catch(() => {});
  }
  // Playwright's CDP adapter closes its transport here, leaving the host process to the launch script.
  if (browser) await browser.close().catch(() => {});
  if (exportedLogPath && exportDirectory && path.dirname(exportedLogPath) === path.resolve(exportDirectory) && path.basename(exportedLogPath).startsWith(`df01-native-smoke-${args.get('--pid')}-`)) await rm(exportedLogPath, { force: true });
  await writeFile(path.join(output, `${artifactName}-smoke.json`), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
