use crate::protocol::{encode, Decoder, Frame};
use serde::{Deserialize, Serialize};
use serialport::SerialPort;
use std::{
    collections::VecDeque,
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex, MutexGuard,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const LOG_LIMIT: usize = 1000;

#[derive(Clone, Debug, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
}
impl AppError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
    fn io(error: impl std::fmt::Display) -> Self {
        Self::new("serial_error", &format!("串口错误：{error}"))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub port: String,
    pub baud_rate: u32,
    pub address: u8,
    pub timeout_ms: u64,
    pub simulation: bool,
    #[serde(default = "default_profile")]
    pub profile: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub connected: bool,
    pub simulation: bool,
    pub port: String,
    pub baud_rate: u32,
    pub address: u8,
    pub profile: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct PortInfo {
    pub name: String,
    pub kind: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRequest {
    pub command: u8,
    pub parameters: Vec<u8>,
    #[serde(default)]
    pub confirmed_write: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub uid_hex: String,
    pub uid_raw_hex: String,
    pub atqa_hex: String,
    pub uid_decimal: String,
    pub card_type: String,
    pub data: Option<Vec<u8>>,
    pub block: Option<u8>,
    pub timestamp: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct CommandResult {
    pub command: u8,
    pub status: u8,
    pub data: Vec<u8>,
    pub message: String,
    pub card: Option<Card>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Preview {
    pub hex: String,
    pub length: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct LogEntry {
    pub id: u64,
    pub timestamp: u64,
    pub direction: String,
    pub command: Option<u8>,
    pub hex: String,
    pub message: String,
    pub level: String,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Stats {
    pub tx: u64,
    pub rx: u64,
    pub errors: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConfiguration {
    pub module_id: u8,
    pub baud_rate: u32,
    pub auto_mode: u8,
    pub auto_block: u8,
    pub auto_initial_value: Vec<u8>,
    pub key_a: Vec<u8>,
    pub key_b: Vec<u8>,
    pub reset_ms: u16,
    pub antenna_gain: u8,
}
impl Default for DeviceConfiguration {
    fn default() -> Self {
        Self {
            module_id: 0,
            baud_rate: 115200,
            auto_mode: 0,
            auto_block: 1,
            auto_initial_value: vec![0, 0, 0, 1],
            key_a: vec![255; 6],
            key_b: vec![255; 6],
            reset_ms: 0,
            antenna_gain: 4,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub connection: Connection,
    pub logs: Vec<LogEntry>,
    pub last_card: Option<Card>,
    pub stats: Stats,
    pub simulation_card_present: bool,
    pub simulation_uid: String,
    pub auto_mode: Option<u8>,
    pub auto_block: Option<u8>,
    pub configuration: Option<DeviceConfiguration>,
}

struct Core {
    connection: Connection,
    logs: VecDeque<LogEntry>,
    last_card: Option<Card>,
    stats: Stats,
    next_id: u64,
    simulation_card_present: bool,
    simulation_uid: [u8; 4],
    auto_mode: Option<u8>,
    auto_block: Option<u8>,
    configuration: Option<DeviceConfiguration>,
}
impl Default for Core {
    fn default() -> Self {
        Self {
            connection: Connection {
                baud_rate: 115200,
                profile: default_profile(),
                ..Default::default()
            },
            logs: VecDeque::new(),
            last_card: None,
            stats: Stats::default(),
            next_id: 1,
            simulation_card_present: true,
            simulation_uid: [0xE0, 0x45, 0xAF, 0xAB],
            auto_mode: None,
            auto_block: None,
            configuration: None,
        }
    }
}
impl Core {
    fn log(
        &mut self,
        direction: &str,
        command: Option<u8>,
        hex: String,
        message: &str,
        level: &str,
    ) {
        if level == "error" {
            self.stats.errors += 1;
        }
        if self.logs.len() >= LOG_LIMIT {
            self.logs.pop_front();
        }
        self.logs.push_back(LogEntry {
            id: self.next_id,
            timestamp: now(),
            direction: direction.into(),
            command,
            hex,
            message: message.into(),
            level: level.into(),
        });
        self.next_id += 1;
    }
}

struct Work {
    request: CommandRequest,
    reply: mpsc::Sender<Result<CommandResult, AppError>>,
}
struct Worker {
    sender: mpsc::SyncSender<Work>,
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

#[derive(Clone, Default)]
pub struct Service {
    core: Arc<Mutex<Core>>,
    worker: Arc<Mutex<Option<Worker>>>,
}

fn lock<T>(value: &Mutex<T>) -> Result<MutexGuard<'_, T>, AppError> {
    value
        .lock()
        .map_err(|_| AppError::new("internal_error", "内部状态锁异常，请重新启动程序"))
}
fn default_profile() -> String {
    "current".into()
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn list_ports() -> Result<Vec<PortInfo>, AppError> {
    let mut ports: Vec<_> = serialport::available_ports()
        .map_err(AppError::io)?
        .into_iter()
        .map(|p| PortInfo {
            name: p.port_name,
            kind: match p.port_type {
                serialport::SerialPortType::UsbPort(info) => format!(
                    "USB {:04X}:{:04X}{}",
                    info.vid,
                    info.pid,
                    info.product.map(|s| format!(" · {s}")).unwrap_or_default()
                ),
                serialport::SerialPortType::BluetoothPort => "Bluetooth".into(),
                serialport::SerialPortType::PciPort => "PCI".into(),
                serialport::SerialPortType::Unknown => "Serial".into(),
            },
        })
        .collect();
    ports.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(ports)
}

impl Service {
    pub fn connect(&self, config: Config) -> Result<Connection, AppError> {
        if !matches!(config.profile.as_str(), "current" | "full") {
            return Err(AppError::new(
                "invalid_profile",
                "固件配置必须为 current 或 full",
            ));
        }
        if config.baud_rate != 115200 {
            return Err(AppError::new("invalid_baud", "上位机固定使用 115200 bit/s"));
        }
        if !(100..=15000).contains(&config.timeout_ms) {
            return Err(AppError::new(
                "invalid_timeout",
                "应答超时必须在 100 至 15000 ms 之间",
            ));
        }
        if !config.simulation && (config.port.trim().is_empty() || config.port.len() > 256) {
            return Err(AppError::new("invalid_port", "请选择有效串口"));
        }
        let mut worker = lock(&self.worker)?;
        stop_worker(&mut worker);
        {
            let mut core = lock(&self.core)?;
            core.connection.connected = false;
        }
        let transport = if config.simulation {
            let mut simulator = Simulator::new();
            simulator.configuration.module_id = config.address;
            Transport::Simulation(Box::new(simulator))
        } else {
            let port = serialport::new(&config.port, config.baud_rate)
                .data_bits(serialport::DataBits::Eight)
                .stop_bits(serialport::StopBits::One)
                .parity(serialport::Parity::None)
                .flow_control(serialport::FlowControl::None)
                .timeout(Duration::from_millis(20))
                .open()
                .map_err(|e| {
                    let error = AppError::io(e);
                    if let Ok(mut core) = self.core.lock() {
                        core.log("system", None, String::new(), &error.message, "error");
                    }
                    error
                })?;
            port.clear(serialport::ClearBuffer::All)
                .map_err(AppError::io)?;
            Transport::Serial(port)
        };
        let connection = Connection {
            connected: true,
            simulation: config.simulation,
            port: if config.simulation {
                "DF-01 Simulator".into()
            } else {
                config.port.clone()
            },
            baud_rate: config.baud_rate,
            address: config.address,
            profile: config.profile.clone(),
        };
        {
            let mut core = lock(&self.core)?;
            core.connection = connection.clone();
            core.last_card = None;
            core.simulation_card_present = true;
            core.simulation_uid = [0xE0, 0x45, 0xAF, 0xAB];
            core.auto_mode = None;
            core.auto_block = None;
            core.configuration = None;
            core.log(
                "system",
                None,
                String::new(),
                if config.simulation {
                    "模拟设备已连接"
                } else {
                    "串口已连接 · 8N1"
                },
                "success",
            );
        }
        let (sender, receiver) = mpsc::sync_channel(8);
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let core = self.core.clone();
        let worker_core = core.clone();
        let join = thread::Builder::new()
            .name("df01-serial".into())
            .spawn(move || {
                let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    run_worker(
                        transport,
                        receiver,
                        worker_stop,
                        worker_core,
                        config.timeout_ms,
                    )
                }));
                if let Ok(mut core) = core.lock() {
                    core.connection.connected = false;
                    if outcome.is_err() {
                        core.log(
                            "system",
                            None,
                            String::new(),
                            "串口工作线程异常，连接已关闭",
                            "error",
                        );
                    }
                }
            })
            .map_err(|e| {
                if let Ok(mut core) = self.core.lock() {
                    core.connection.connected = false;
                }
                AppError::new("worker_start_failed", &format!("无法启动串口线程：{e}"))
            })?;
        *worker = Some(Worker {
            sender,
            stop,
            join: Some(join),
        });
        drop(worker);
        let result = self.execute(CommandRequest {
            command: 0x31,
            parameters: vec![],
            confirmed_write: false,
        })?;
        if result.status != 0 {
            self.disconnect()?;
            return Err(AppError::new(
                "configuration_failed",
                &format!("读取模块配置失败：{}", result.message),
            ));
        }
        Ok(lock(&self.core)?.connection.clone())
    }

    pub fn disconnect(&self) -> Result<(), AppError> {
        let mut worker = lock(&self.worker)?;
        let was_connected = lock(&self.core)?.connection.connected;
        stop_worker(&mut worker);
        let mut core = lock(&self.core)?;
        core.connection.connected = false;
        if was_connected {
            core.log("system", None, String::new(), "连接已关闭", "info");
        }
        Ok(())
    }

    pub fn snapshot(&self) -> Result<Snapshot, AppError> {
        let core = lock(&self.core)?;
        Ok(Snapshot {
            connection: core.connection.clone(),
            logs: core.logs.iter().cloned().collect(),
            last_card: core.last_card.clone(),
            stats: core.stats.clone(),
            simulation_card_present: core.simulation_card_present,
            simulation_uid: core
                .simulation_uid
                .iter()
                .map(|b| format!("{b:02X}"))
                .collect(),
            auto_mode: core.auto_mode,
            auto_block: core.auto_block,
            configuration: core.configuration.clone(),
        })
    }

    pub fn clear_logs(&self) -> Result<(), AppError> {
        lock(&self.core)?.logs.clear();
        Ok(())
    }

    pub fn set_simulation_card(&self, present: bool) -> Result<(), AppError> {
        let mut core = lock(&self.core)?;
        if !core.connection.connected || !core.connection.simulation {
            return Err(AppError::new("not_simulation", "此操作需要连接模拟设备"));
        }
        core.simulation_card_present = present;
        core.log(
            "system",
            None,
            String::new(),
            if present {
                "模拟卡片已放入"
            } else {
                "模拟卡片已移开"
            },
            "info",
        );
        Ok(())
    }

    pub fn simulate_next_card(&self) -> Result<(), AppError> {
        let mut core = lock(&self.core)?;
        if !core.connection.connected || !core.connection.simulation {
            return Err(AppError::new("not_simulation", "此操作需要连接模拟设备"));
        }
        core.simulation_uid = if core.simulation_uid == [0xE0, 0x45, 0xAF, 0xAB] {
            [0xAA, 0xBB, 0xCC, 0xDD]
        } else {
            [0xE0, 0x45, 0xAF, 0xAB]
        };
        core.simulation_card_present = true;
        core.log(
            "system",
            None,
            String::new(),
            "已换入另一张模拟卡片",
            "info",
        );
        Ok(())
    }

    pub fn preview(&self, request: CommandRequest) -> Result<Preview, AppError> {
        validate(&request)?;
        let sensitive = sensitive_request(&request);
        let frame = Frame {
            address: lock(&self.core)?.connection.address,
            command: request.command,
            parameters: request.parameters,
        };
        let bytes = encode(&frame).map_err(|m| AppError::new("invalid_frame", &m))?;
        Ok(Preview {
            hex: if sensitive {
                "[密钥内容及校验已隐藏]".into()
            } else {
                hex(&bytes)
            },
            length: bytes.len(),
        })
    }

    pub fn execute(&self, request: CommandRequest) -> Result<CommandResult, AppError> {
        validate(&request)?;
        let (reply, result) = mpsc::channel();
        {
            let worker = lock(&self.worker)?;
            if !lock(&self.core)?.connection.connected {
                return Err(AppError::new("not_connected", "请先连接设备"));
            }
            worker
                .as_ref()
                .ok_or_else(|| AppError::new("not_connected", "串口线程未启动"))?
                .sender
                .try_send(Work { request, reply })
                .map_err(|e| match e {
                    mpsc::TrySendError::Full(_) => {
                        AppError::new("busy", "命令队列已满，请等待当前操作完成")
                    }
                    mpsc::TrySendError::Disconnected(_) => {
                        AppError::new("not_connected", "设备连接已关闭")
                    }
                })?;
        }
        result
            .recv()
            .map_err(|_| AppError::new("disconnected", "串口连接已关闭，待处理命令已取消"))?
    }
}

fn stop_worker(worker: &mut Option<Worker>) {
    if let Some(mut previous) = worker.take() {
        previous.stop.store(true, Ordering::Release);
        if let Some(join) = previous.join.take() {
            let _ = join.join();
        }
    }
}

fn validate(request: &CommandRequest) -> Result<(), AppError> {
    let p = &request.parameters;
    let invalid = || AppError::new("invalid_parameters", "命令参数长度或确认字节不符合手册");
    match request.command {
        0x10 if p.is_empty() => (),
        0x11 if p.len() == 1 => (),
        0x12 if p.len() == 17 && (1..=63).contains(&p[0]) => {
            if p[0] % 4 == 3 && !request.confirmed_write {
                return Err(AppError::new(
                    "confirmation_required",
                    "扇区尾块包含密钥和访问控制位，必须明确确认后写入",
                ));
            }
        }
        0x2B if p.len() == 18 && p[12..] == [0x00, 0x03, 0x08, 0x05, 0x02, 0x07] => (),
        0x2D if p.len() == 4 && p[1..] == [0x37, 0x21, 0x56] => (),
        0x2E if p.len() == 10 && p[0] <= 2 && p[1] == p[0] + 10 && p[7..] == [0x23, 0x12, 0x54] => {
        }
        0x2F if p.len() == 2 && valid_reset(u16::from_le_bytes([p[0], p[1]])) => (),
        0x30 if p.len() == 1 && p[0] <= 7 => (),
        0x31 if p.is_empty() => (),
        0x10 | 0x11 | 0x12 | 0x2B | 0x2D | 0x2E | 0x2F | 0x30 | 0x31 => return Err(invalid()),
        _ => {
            return Err(AppError::new(
                "excluded_operation",
                "仅允许读卡号、读写块、装载密钥、设置地址、自动方式、防重读、增益和读取配置",
            ))
        }
    }
    Ok(())
}

fn valid_reset(value: u16) -> bool {
    value == 0 || (100..=3000).contains(&value)
}

fn sensitive_request(request: &CommandRequest) -> bool {
    request.command == 0x2B
        || (request.command == 0x12
            && request
                .parameters
                .first()
                .is_some_and(|block| block % 4 == 3))
}

enum Transport {
    Serial(Box<dyn SerialPort>),
    Simulation(Box<Simulator>),
}

fn run_worker(
    mut transport: Transport,
    receiver: mpsc::Receiver<Work>,
    stop: Arc<AtomicBool>,
    core: Arc<Mutex<Core>>,
    timeout_ms: u64,
) {
    let mut decoder = Decoder::default();
    while !stop.load(Ordering::Acquire) {
        match receiver.try_recv() {
            Ok(work) => {
                let outcome = transact(
                    &mut transport,
                    &mut decoder,
                    &stop,
                    &core,
                    &work.request,
                    timeout_ms,
                );
                let fatal = outcome.as_ref().err().is_some_and(|e| {
                    matches!(
                        e.code.as_str(),
                        "timeout"
                            | "uncertain_result"
                            | "serial_error"
                            | "disconnected"
                            | "internal_error"
                    )
                });
                if let Err(error) = &outcome {
                    if let Ok(mut state) = core.lock() {
                        state.log(
                            "system",
                            Some(work.request.command),
                            String::new(),
                            &error.message,
                            "error",
                        );
                    }
                }
                let _ = work.reply.send(outcome);
                if fatal {
                    break;
                }
            }
            Err(mpsc::TryRecvError::Disconnected) => break,
            Err(mpsc::TryRecvError::Empty) => {
                if let Transport::Simulation(simulator) = &mut transport {
                    if let Ok(state) = core.lock() {
                        let _ = simulator.tick(
                            state.simulation_card_present,
                            state.simulation_uid,
                            state.connection.address,
                        );
                    }
                }
                match read_frames(&mut transport, &mut decoder) {
                    Ok(frames) => {
                        for frame in frames {
                            let _ = record_frame(&core, frame, None);
                        }
                    }
                    Err(error) => {
                        if let Ok(mut state) = core.lock() {
                            state.log("system", None, String::new(), &error.message, "error");
                        }
                        break;
                    }
                }
                if matches!(transport, Transport::Simulation(_)) {
                    thread::sleep(Duration::from_millis(10));
                }
            }
        }
    }
    decoder.clear();
    if let Ok(mut state) = core.lock() {
        state.connection.connected = false;
    }
}

fn transact(
    transport: &mut Transport,
    decoder: &mut Decoder,
    stop: &AtomicBool,
    core: &Mutex<Core>,
    request: &CommandRequest,
    timeout_ms: u64,
) -> Result<CommandResult, AppError> {
    if stop.load(Ordering::Acquire) {
        return Err(AppError::new("disconnected", "操作已随断开连接取消"));
    }
    drain_before_send(transport, decoder, core, stop)?;
    let address = {
        let state = lock(core)?;
        // A 91 frame carries no block number, so conflicting automatic reads cannot be attributed safely.
        if request.command == 0x11
            && state.auto_mode == Some(2)
            && state.auto_block != request.parameters.first().copied()
        {
            return Err(AppError::new(
                "automatic_read_conflict",
                "自动读块与本次目标不同，请先关闭自动读取再读取此块；命令未发送",
            ));
        }
        state.connection.address
    };
    let frame = Frame {
        address,
        command: request.command,
        parameters: request.parameters.clone(),
    };
    let bytes = encode(&frame).map_err(|m| AppError::new("invalid_frame", &m))?;
    {
        let mut state = lock(core)?;
        state.stats.tx += 1;
        state.log(
            "tx",
            Some(request.command),
            if sensitive_request(request) {
                "[密钥帧已隐藏]".into()
            } else {
                hex(&bytes)
            },
            &format!("发送 {}", command_name(request.command)),
            "info",
        );
    }
    match transport {
        Transport::Serial(port) => {
            // Windows serialport uses one timeout for both read and write operations.
            let baud = u64::from(lock(core)?.connection.baud_rate.max(1));
            let wire_time_ms = (bytes.len() as u64 * 10 * 1000).div_ceil(baud);
            port.set_timeout(Duration::from_millis(wire_time_ms + 100))
                .map_err(AppError::io)?;
            let written = port.write_all(&bytes);
            let restored = port.set_timeout(Duration::from_millis(20));
            written.map_err(|error| transfer_error(request, error))?;
            restored.map_err(|error| transfer_error(request, error))?;
        }
        Transport::Simulation(simulator) => {
            let mut request_decoder = Decoder::default();
            let parsed = request_decoder
                .push(&bytes)
                .into_iter()
                .next()
                .ok_or_else(|| AppError::new("internal_error", "模拟请求帧未完成"))?
                .map_err(|m| AppError::new("internal_error", &m))?;
            let (present, uid) = {
                let state = lock(core)?;
                (state.simulation_card_present, state.simulation_uid)
            };
            simulator.respond(parsed, present, uid)?;
        }
    }
    let started = Instant::now();
    loop {
        if stop.load(Ordering::Acquire) {
            return Err(AppError::new(
                "disconnected",
                "连接已关闭；已发送的写入或设置命令可能已执行，请核实设备状态",
            ));
        }
        if started.elapsed() >= Duration::from_millis(timeout_ms) {
            let mutation = !matches!(request.command, 0x10 | 0x11 | 0x31);
            return Err(AppError::new(
                if mutation {
                    "uncertain_result"
                } else {
                    "timeout"
                },
                if mutation {
                    "等待应答超时，设备可能已执行操作。连接已关闭以避免迟到应答误配，请核实设备配置或卡片数据后重新连接；程序未重试"
                } else {
                    "等待设备应答超时，连接已关闭以避免迟到应答误配。请检查卡片、地址、波特率和接线后重新连接"
                },
            ));
        }
        let frames = read_frames(transport, decoder)
            .map_err(|error| transfer_error(request, error.message))?;
        let mut matched = None;
        for frame in frames {
            let address_matches = frame.as_ref().is_ok_and(|f| {
                if request.command == 0x2D && f.parameters.first() == Some(&0) {
                    f.address == request.parameters[0]
                } else {
                    f.address == address
                }
            });
            let is_match = matched.is_none()
                && address_matches
                && frame
                    .as_ref()
                    .is_ok_and(|f| f.command == (request.command | 0x80));
            let result = record_frame(core, frame, if is_match { Some(request) } else { None });
            if is_match {
                if result.as_ref().is_some_and(|result| result.status == 0) {
                    apply_ack(core, request, result.as_ref().unwrap())?;
                }
                matched = result;
            }
        }
        if let Some(result) = matched {
            return Ok(result);
        }
        if matches!(transport, Transport::Simulation(_)) {
            thread::sleep(Duration::from_millis(5));
        }
    }
}

fn apply_ack(
    core: &Mutex<Core>,
    request: &CommandRequest,
    result: &CommandResult,
) -> Result<(), AppError> {
    let mut state = lock(core)?;
    if request.command == 0x2D {
        state.connection.address = request.parameters[0];
    }
    if request.command == 0x2E {
        state.auto_mode = Some(request.parameters[0]);
        state.auto_block = Some(request.parameters[2]);
    }
    let Some(configuration) = &mut state.configuration else {
        return Ok(());
    };
    match request.command {
        0x2B => {
            configuration.key_a = request.parameters[..6].to_vec();
            configuration.key_b = request.parameters[6..12].to_vec();
        }
        0x2D => configuration.module_id = request.parameters[0],
        0x2E => {
            configuration.auto_mode = request.parameters[0];
            configuration.auto_block = request.parameters[2];
            configuration.auto_initial_value = request.parameters[3..7].to_vec();
        }
        0x2F => {
            configuration.reset_ms =
                u16::from_le_bytes([request.parameters[0], request.parameters[1]])
        }
        0x30 => configuration.antenna_gain = result.data[1],
        _ => (),
    }
    Ok(())
}

fn transfer_error(request: &CommandRequest, error: impl std::fmt::Display) -> AppError {
    if matches!(request.command, 0x10 | 0x11 | 0x31) {
        AppError::io(error)
    } else {
        AppError::new("uncertain_result", &format!("通信中断：{error}。设备可能已执行写入或设置，连接已关闭；请核实设备状态后重新连接，程序未重试"))
    }
}

fn read_frames(
    transport: &mut Transport,
    decoder: &mut Decoder,
) -> Result<Vec<Result<Frame, String>>, AppError> {
    let mut bytes = [0u8; 512];
    let count = read_bytes(transport, &mut bytes)?;
    Ok(decoder.push(&bytes[..count]))
}

fn read_bytes(transport: &mut Transport, bytes: &mut [u8]) -> Result<usize, AppError> {
    match transport {
        Transport::Serial(port) => match port.read(bytes) {
            Ok(count) => Ok(count),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::TimedOut
                        | std::io::ErrorKind::WouldBlock
                        | std::io::ErrorKind::Interrupted
                ) =>
            {
                Ok(0)
            }
            Err(error) => Err(AppError::io(error)),
        },
        Transport::Simulation(simulator) => Ok(simulator.read(bytes)),
    }
}

fn drain_before_send(
    transport: &mut Transport,
    decoder: &mut Decoder,
    core: &Mutex<Core>,
    stop: &AtomicBool,
) -> Result<(), AppError> {
    let started = Instant::now();
    let mut last_activity = started;
    let mut bytes = [0u8; 512];
    loop {
        if stop.load(Ordering::Acquire) {
            return Err(AppError::new("disconnected", "操作已随断开连接取消"));
        }
        let count = read_bytes(transport, &mut bytes)?;
        if count > 0 {
            last_activity = Instant::now();
            for frame in decoder.push(&bytes[..count]) {
                let _ = record_frame(core, frame, None);
            }
        }
        let pending_simulation =
            matches!(transport, Transport::Simulation(simulator) if !simulator.response.is_empty());
        if !pending_simulation && last_activity.elapsed() >= Duration::from_millis(30) {
            if !decoder.is_empty() {
                decoder.clear();
                lock(core)?.log(
                    "system",
                    None,
                    String::new(),
                    "发送前已清除静默后的残缺帧",
                    "warning",
                );
            }
            return Ok(());
        }
        if started.elapsed() >= Duration::from_millis(200) {
            return Err(AppError::new(
                "busy",
                "设备持续主动上报，暂未发送命令；请等待串口空闲",
            ));
        }
        thread::sleep(Duration::from_millis(1));
    }
}

fn record_frame(
    core: &Mutex<Core>,
    frame: Result<Frame, String>,
    request: Option<&CommandRequest>,
) -> Option<CommandResult> {
    let mut state = core.lock().ok()?;
    let frame = match frame {
        Ok(frame) => frame,
        Err(error) => {
            state.log(
                "system",
                None,
                String::new(),
                &format!("丢弃损坏帧：{error}"),
                "error",
            );
            return None;
        }
    };
    if !matches!(
        frame.command,
        0x90 | 0x91 | 0x92 | 0xAB | 0xAD | 0xAE | 0xAF | 0xB0 | 0xB1
    ) {
        state.log(
            "system",
            None,
            String::new(),
            "已忽略范围外应答，未记录其负载",
            "warning",
        );
        return None;
    }
    if request.is_none() && frame.address != state.connection.address {
        state.log(
            "system",
            Some(frame.command),
            String::new(),
            &format!("忽略其他地址的应答：{:02X}", frame.address),
            "warning",
        );
        return None;
    }
    state.stats.rx += 1;
    let status = match frame.parameters.first() {
        Some(s) => *s,
        None => {
            state.log(
                "system",
                Some(frame.command),
                String::new(),
                "应答缺少状态字节",
                "error",
            );
            return None;
        }
    };
    let expected = match frame.command {
        0x90 | 0x92 => 7,
        0x91 => 23,
        0xB0 => 2,
        0xB1 => 27,
        _ => 1,
    };
    if (status == 0 && frame.parameters.len() != expected)
        || (status != 0 && frame.parameters.len() != 1 && frame.parameters.len() != expected)
    {
        state.log(
            "system",
            Some(frame.command),
            String::new(),
            "应答负载长度不符合手册",
            "error",
        );
        return None;
    }
    if status == 0 && frame.command == 0xB0 && frame.parameters[1] > 7 {
        state.log(
            "system",
            Some(frame.command),
            String::new(),
            "增益响应档位超出范围",
            "error",
        );
        return None;
    }
    if status == 0 && frame.command == 0xB1 {
        let p = &frame.parameters;
        let reset_ms = u16::from_le_bytes([p[24], p[25]]);
        if p[1] != frame.address || p[6] > 2 || !valid_reset(reset_ms) || p[26] > 7 {
            state.log(
                "system",
                Some(frame.command),
                String::new(),
                "模块配置字段无效",
                "error",
            );
            return None;
        }
        state.configuration = Some(DeviceConfiguration {
            module_id: p[1],
            baud_rate: u32::from_le_bytes(p[2..6].try_into().ok()?),
            auto_mode: p[6],
            auto_block: p[7],
            auto_initial_value: p[8..12].to_vec(),
            key_a: p[12..18].to_vec(),
            key_b: p[18..24].to_vec(),
            reset_ms,
            antenna_gain: p[26],
        });
        state.connection.address = p[1];
        state.auto_mode = Some(p[6]);
        state.auto_block = Some(p[7]);
    }
    let card = if status == 0 && matches!(frame.command, 0x90..=0x92) {
        let uid: [u8; 4] = frame.parameters[3..7].try_into().ok()?;
        let number = u32::from_le_bytes(uid);
        Some(Card {
            uid_hex: format!("{number:08X}"),
            uid_raw_hex: hex(&uid),
            atqa_hex: hex(&frame.parameters[1..3]),
            uid_decimal: number.to_string(),
            card_type: match frame.parameters[1..3] {
                [0x04, 0x00] => "S50".into(),
                [0x44, 0x00] => "Ultralight".into(),
                _ => format!("未知 ({})", hex(&frame.parameters[1..3])),
            },
            data: if frame.command == 0x91 {
                Some(frame.parameters[7..].to_vec())
            } else {
                None
            },
            block: request
                .filter(|r| matches!(r.command, 0x11 | 0x12))
                .map(|r| r.parameters[0])
                .or_else(|| {
                    if frame.command == 0x91 && state.auto_mode == Some(2) {
                        state.auto_block
                    } else {
                        None
                    }
                }),
            timestamp: now(),
        })
    } else {
        None
    };
    if let Some(card) = &card {
        state.last_card = Some(card.clone());
    }
    let message = status_message(status);
    let mut wire_hex = encode(&frame).map(|bytes| hex(&bytes)).unwrap_or_default();
    // Sector trailer reads contain card keys; never retain them in wire logs.
    if frame.command == 0x91
        && card
            .as_ref()
            .and_then(|c| c.block)
            .is_none_or(|block| block % 4 == 3)
    {
        wire_hex = "[块数据可能含密钥，帧已隐藏]".into();
    }
    if frame.command == 0xB1 {
        wire_hex = "[配置含密钥，帧已隐藏]".into();
    }
    state.log(
        "rx",
        Some(frame.command),
        wire_hex,
        &format!(
            "{}{}：{}",
            if request.is_none() && matches!(frame.command, 0x90 | 0x91) {
                "主动上报 · "
            } else if request.is_none() {
                "未匹配应答 · "
            } else {
                ""
            },
            command_name(frame.command & 0x7F),
            message
        ),
        if status == 0 { "success" } else { "warning" },
    );
    Some(CommandResult {
        command: frame.command & 0x7F,
        status,
        data: frame.parameters,
        message,
        card,
    })
}

fn command_name(command: u8) -> &'static str {
    match command {
        0x10 => "读卡号",
        0x11 => "读块数据",
        0x12 => "写块数据",
        0x2B => "装载密钥",
        0x2D => "设置地址",
        0x2E => "设置自动方式",
        0x2F => "设置防重读时长",
        0x30 => "设置天线增益",
        0x31 => "读取全部配置",
        _ => "未知命令",
    }
}
fn status_message(status: u8) -> String {
    match status {
        0x00 => "成功".into(),
        0xFF => "未检测到卡片".into(),
        0xFE => "读写或参数错误，请检查卡片位置、通信与参数".into(),
        0xFD => "密钥或访问权限错误，Key A / Key B 认证失败或卡片拒绝写入".into(),
        0xFC => "设备返回余额状态 0xFC（范围外）".into(),
        0xFB => "卡片数据块 CRC 校验错误".into(),
        _ => format!("未知设备状态 0x{status:02X}"),
    }
}

struct Simulator {
    blocks: [[[u8; 16]; 64]; 2],
    response: VecDeque<u8>,
    ready_at: Instant,
    configuration: DeviceConfiguration,
    last_auto_uid: Option<[u8; 4]>,
    reported_at: Instant,
}
impl Simulator {
    fn new() -> Self {
        let mut blocks = [[0u8; 16]; 64];
        blocks[0] = [
            0xE0, 0x45, 0xAF, 0xAB, 0xA1, 0x08, 0x04, 0x00, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67,
            0x68, 0x69,
        ];
        blocks[1][..14].copy_from_slice(b"DF-01 FRUITFLY");
        for block in (3..64).step_by(4) {
            blocks[block] = [
                0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x07, 0x80, 0x69, 0xFF, 0xFF, 0xFF, 0xFF,
                0xFF, 0xFF,
            ];
        }
        Self {
            blocks: [blocks, blocks],
            response: VecDeque::new(),
            ready_at: Instant::now(),
            configuration: DeviceConfiguration::default(),
            last_auto_uid: None,
            reported_at: Instant::now(),
        }
    }
    fn respond(&mut self, frame: Frame, present: bool, uid: [u8; 4]) -> Result<(), AppError> {
        if frame.address != self.configuration.module_id {
            return Ok(());
        }
        let mut parameters = vec![0];
        let card_index = usize::from(uid != [0xE0, 0x45, 0xAF, 0xAB]);
        if matches!(frame.command, 0x10..=0x12) {
            if !present {
                parameters[0] = 0xFF;
            } else if frame.command != 0x10 && frame.parameters[0] > 63 {
                parameters[0] = 0xFE;
            } else {
                parameters.extend([0x04, 0x00]);
                parameters.extend(uid);
                if frame.command == 0x11 {
                    let mut data = self.blocks[card_index][frame.parameters[0] as usize];
                    if frame.parameters[0] == 0 {
                        data[..4].copy_from_slice(&uid);
                        data[4] = uid.iter().fold(0, |checksum, byte| checksum ^ byte);
                    }
                    parameters.extend(data);
                }
                if frame.command == 0x12 {
                    self.blocks[card_index][frame.parameters[0] as usize]
                        .copy_from_slice(&frame.parameters[1..]);
                }
                if matches!(frame.command, 0x10 | 0x11) && self.last_auto_uid == Some(uid) {
                    self.last_auto_uid = None;
                }
            }
        }
        if frame.command == 0x2E {
            self.configuration.auto_mode = frame.parameters[0];
            self.configuration.auto_block = frame.parameters[2];
            self.configuration.auto_initial_value = frame.parameters[3..7].to_vec();
            self.last_auto_uid = None;
        }
        if frame.command == 0x2B {
            self.configuration.key_a = frame.parameters[..6].to_vec();
            self.configuration.key_b = frame.parameters[6..12].to_vec();
        }
        if frame.command == 0x2D {
            self.configuration.module_id = frame.parameters[0];
        }
        if frame.command == 0x2F {
            self.configuration.reset_ms =
                u16::from_le_bytes([frame.parameters[0], frame.parameters[1]]);
            self.last_auto_uid = None;
        }
        if frame.command == 0x30 {
            self.configuration.antenna_gain = frame.parameters[0];
            parameters.push(self.configuration.antenna_gain);
        }
        if frame.command == 0x31 {
            let c = &self.configuration;
            parameters.push(c.module_id);
            parameters.extend(c.baud_rate.to_le_bytes());
            parameters.extend([c.auto_mode, c.auto_block]);
            parameters.extend(&c.auto_initial_value);
            parameters.extend(&c.key_a);
            parameters.extend(&c.key_b);
            parameters.extend(c.reset_ms.to_le_bytes());
            parameters.push(c.antenna_gain);
        }
        self.response.extend(
            encode(&Frame {
                address: self.configuration.module_id,
                command: frame.command | 0x80,
                parameters,
            })
            .map_err(|m| AppError::new("internal_error", &m))?,
        );
        self.ready_at = Instant::now() + Duration::from_millis(35);
        Ok(())
    }
    fn tick(&mut self, present: bool, uid: [u8; 4], address: u8) -> Result<(), AppError> {
        if self.configuration.reset_ms > 0
            && self.reported_at.elapsed()
                >= Duration::from_millis(u64::from(self.configuration.reset_ms))
        {
            self.last_auto_uid = None;
        }
        if !present
            || self.configuration.auto_mode == 1
            || self.last_auto_uid == Some(uid)
            || !self.response.is_empty()
            || (self.configuration.auto_mode == 2 && self.configuration.auto_block > 63)
        {
            return Ok(());
        }
        let command = if self.configuration.auto_mode == 0 {
            0x10
        } else {
            0x11
        };
        self.respond(
            Frame {
                address,
                command,
                parameters: if command == 0x11 {
                    vec![self.configuration.auto_block]
                } else {
                    vec![]
                },
            },
            true,
            uid,
        )?;
        self.last_auto_uid = Some(uid);
        self.reported_at = Instant::now();
        Ok(())
    }
    fn read(&mut self, destination: &mut [u8]) -> usize {
        if Instant::now() < self.ready_at {
            return 0;
        }
        let count = self.response.len().min(destination.len()).min(5);
        for item in destination.iter_mut().take(count) {
            *item = self.response.pop_front().unwrap_or_default();
        }
        count
    }
}

#[cfg(test)]
#[path = "device_tests.rs"]
mod serial_tests;

#[cfg(test)]
mod tests {
    use super::*;
    fn request(command: u8, parameters: Vec<u8>) -> CommandRequest {
        CommandRequest {
            command,
            parameters,
            confirmed_write: false,
        }
    }
    fn simulator() -> Service {
        let service = Service::default();
        service
            .connect(Config {
                port: String::new(),
                baud_rate: 115200,
                address: 0,
                timeout_ms: 1000,
                simulation: true,
                profile: "current".into(),
            })
            .unwrap();
        service
    }
    #[test]
    fn only_documented_nonfinancial_commands_are_allowed() {
        for command in 0..=255 {
            if !matches!(
                command,
                0x10 | 0x11 | 0x12 | 0x2B | 0x2D | 0x2E | 0x2F | 0x30 | 0x31
            ) {
                assert_eq!(
                    validate(&request(command, vec![])).unwrap_err().code,
                    "excluded_operation"
                );
            }
        }
        assert!(validate(&request(0x11, vec![255])).is_ok());
        assert!(validate(&request(0x12, vec![0; 17])).is_err());
    }
    #[test]
    fn auto_modes_accept_documented_modes_and_ignore_reserved_bytes() {
        let mut req = request(0x2E, vec![2, 12, 1, 0, 0, 0, 0, 0x23, 0x12, 0x54]);
        assert!(validate(&req).is_ok());
        req.parameters[6] = 1;
        assert!(validate(&req).is_ok());
        req.parameters[6] = 0;
        req.parameters[0] = 3;
        req.parameters[1] = 13;
        assert_eq!(validate(&req).unwrap_err().code, "invalid_parameters");
    }
    #[test]
    fn fixed_baud_and_extension_parameter_limits_are_enforced() {
        assert_eq!(
            validate(&request(0x2C, vec![0, 1, 0xC2, 0, 0x98, 0x24, 0x31]))
                .unwrap_err()
                .code,
            "excluded_operation"
        );
        for value in [0u16, 100, 1000, 3000] {
            assert!(validate(&request(0x2F, value.to_le_bytes().to_vec())).is_ok());
        }
        for value in [1u16, 99, 3001, 65535] {
            assert!(validate(&request(0x2F, value.to_le_bytes().to_vec())).is_err());
        }
        assert!(validate(&request(0x30, vec![7])).is_ok());
        assert!(validate(&request(0x30, vec![8])).is_err());
        assert!(validate(&request(0x31, vec![])).is_ok());
    }

    #[test]
    fn firmware_table_auto_mode_examples_are_accepted_verbatim() {
        let service = Service::default();
        for (mode, checksum) in [(0, "4C"), (1, "4C"), (2, "48")] {
            let req = request(0x2E, vec![mode, mode + 10, 1, 0, 0, 0, 1, 0x23, 0x12, 0x54]);
            let preview = service.preview(req).unwrap();
            assert_eq!(
                preview.hex,
                format!(
                    "7F 0D 00 2E {mode:02X} {:02X} 01 00 00 00 01 23 12 54 {checksum}",
                    mode + 10
                )
            );
        }
    }
    #[test]
    fn simulation_roundtrip_write_read_and_no_card() {
        let service = simulator();
        let card = service
            .execute(request(0x10, vec![]))
            .unwrap()
            .card
            .unwrap();
        assert_eq!(card.uid_hex, "ABAF45E0");
        assert_eq!(card.uid_raw_hex, "E0 45 AF AB");
        assert_eq!(card.atqa_hex, "04 00");
        assert_eq!(
            card.uid_decimal,
            u32::from_le_bytes([0xE0, 0x45, 0xAF, 0xAB]).to_string()
        );
        let mut data = vec![1];
        data.extend([0x7F; 16]);
        assert_eq!(service.execute(request(0x12, data)).unwrap().status, 0);
        let result = service.execute(request(0x11, vec![1])).unwrap();
        assert_eq!(result.card.unwrap().data.unwrap(), vec![0x7F; 16]);
        service.set_simulation_card(false).unwrap();
        assert_eq!(service.execute(request(0x10, vec![])).unwrap().status, 0xFF);
        service.disconnect().unwrap();
        assert!(!service.snapshot().unwrap().connection.connected);
    }
    #[test]
    fn configuration_ack_updates_snapshot_and_key_logs_are_redacted() {
        let service = simulator();
        service
            .execute(request(0x2D, vec![0x7F, 0x37, 0x21, 0x56]))
            .unwrap();
        assert_eq!(service.snapshot().unwrap().connection.address, 0x7F);
        service.execute(request(0x2F, vec![0xE8, 3])).unwrap();
        service.execute(request(0x30, vec![7])).unwrap();
        assert_eq!(service.snapshot().unwrap().connection.baud_rate, 115200);
        let configuration = service.snapshot().unwrap().configuration.unwrap();
        assert_eq!(configuration.module_id, 0x7F);
        assert_eq!(configuration.reset_ms, 1000);
        assert_eq!(configuration.antenna_gain, 7);
        let mut keys = vec![0x77; 12];
        keys.extend([0, 3, 8, 5, 2, 7]);
        let req = request(0x2B, keys);
        assert!(!service.preview(req.clone()).unwrap().hex.contains("77"));
        service.execute(req).unwrap();
        service.execute(request(0x31, vec![])).unwrap();
        assert_eq!(
            service.snapshot().unwrap().configuration.unwrap().key_a,
            vec![0x77; 6]
        );
        assert!(!service
            .snapshot()
            .unwrap()
            .logs
            .iter()
            .any(|log| log.hex.contains("77 77")));
        service.disconnect().unwrap();
    }
    #[test]
    fn excluded_response_never_enters_logs_or_card_state() {
        let core = Mutex::new(Core::default());
        record_frame(
            &core,
            Ok(Frame {
                address: 0,
                command: 0xA0,
                parameters: vec![0xAA; 11],
            }),
            None,
        );
        let core = core.lock().unwrap();
        assert!(core.last_card.is_none());
        assert!(core.logs.iter().all(|log| log.hex.is_empty()));
    }
    #[test]
    fn logs_are_bounded() {
        let mut core = Core::default();
        for _ in 0..2000 {
            core.log("system", None, String::new(), "event", "info");
        }
        assert_eq!(core.logs.len(), LOG_LIMIT);
        assert_eq!(core.logs.front().unwrap().id, 1001);
    }

    #[test]
    fn simulation_implements_reset_expiry_and_manual_read_dedup_clear() {
        let mut simulator = Simulator::new();
        let uid = [1, 2, 3, 4];
        simulator.tick(true, uid, 0).unwrap();
        assert_eq!(simulator.last_auto_uid, Some(uid));
        simulator.response.clear();
        simulator.tick(false, uid, 0).unwrap();
        simulator.tick(true, uid, 0).unwrap();
        assert!(simulator.response.is_empty());
        simulator
            .respond(
                Frame {
                    address: 0,
                    command: 0x10,
                    parameters: vec![],
                },
                true,
                uid,
            )
            .unwrap();
        assert_eq!(simulator.last_auto_uid, None);
        simulator.response.clear();
        simulator.tick(true, uid, 0).unwrap();
        assert!(!simulator.response.is_empty());
        simulator.response.clear();
        simulator.configuration.reset_ms = 100;
        simulator.reported_at = Instant::now() - Duration::from_millis(101);
        simulator.tick(true, uid, 0).unwrap();
        assert!(!simulator.response.is_empty());
        simulator.response.clear();
        simulator
            .respond(
                Frame {
                    address: 0,
                    command: 0x2E,
                    parameters: vec![0, 10, 1, 0, 0, 0, 1, 0x23, 0x12, 0x54],
                },
                true,
                uid,
            )
            .unwrap();
        assert_eq!(simulator.last_auto_uid, None);
    }

    #[test]
    fn current_firmware_rejects_nondefault_connection_before_opening_serial() {
        let service = Service::default();
        let error = service
            .connect(Config {
                port: "COM-NOT-OPENED".into(),
                baud_rate: 9600,
                address: 0,
                timeout_ms: 1000,
                simulation: false,
                profile: "current".into(),
            })
            .unwrap_err();
        assert_eq!(error.code, "invalid_baud");
    }

    #[test]
    fn current_firmware_never_queues_baud_or_unimplemented_commands() {
        let service = Service::default();
        {
            let mut core = service.core.lock().unwrap();
            core.connection.connected = true;
            core.connection.simulation = false;
        }
        let (sender, receiver) = mpsc::sync_channel(8);
        *service.worker.lock().unwrap() = Some(Worker {
            sender,
            stop: Arc::new(AtomicBool::new(false)),
            join: None,
        });
        for req in [
            request(0x2C, vec![0, 1, 0xC2, 0, 0x98, 0x24, 0x31]),
            request(0x13, vec![1, 0, 0, 0, 0]),
        ] {
            assert_eq!(service.execute(req).unwrap_err().code, "excluded_operation");
        }
        assert!(matches!(
            receiver.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));
        assert_eq!(service.snapshot().unwrap().stats.tx, 0);
        service.disconnect().unwrap();
    }

    #[test]
    fn sensitive_trailer_operations_are_redacted() {
        let service = simulator();
        let mut req = request(0x12, vec![0xAB; 17]);
        req.parameters[0] = 3;
        assert_eq!(
            service.execute(req.clone()).unwrap_err().code,
            "confirmation_required"
        );
        req.confirmed_write = true;
        assert!(!service.preview(req.clone()).unwrap().hex.contains("AB AB"));
        service.execute(req).unwrap();
        service.execute(request(0x11, vec![3])).unwrap();
        assert!(!service
            .snapshot()
            .unwrap()
            .logs
            .iter()
            .any(|log| log.hex.contains("AB AB")));
        service.disconnect().unwrap();
    }
}
