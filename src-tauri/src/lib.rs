mod device;
mod log_export;
mod protocol;

use device::{
    AppError, CommandRequest, CommandResult, Config, Connection, PortInfo, Preview, Service,
    Snapshot,
};
use tauri::{Manager, State};

#[tauri::command]
async fn list_ports() -> Result<Vec<PortInfo>, AppError> {
    blocking(device::list_ports).await
}

#[tauri::command]
async fn connect_device(config: Config, state: State<'_, Service>) -> Result<Connection, AppError> {
    let service = state.inner().clone();
    blocking(move || service.connect(config)).await
}

#[tauri::command]
async fn disconnect_device(state: State<'_, Service>) -> Result<(), AppError> {
    let service = state.inner().clone();
    blocking(move || service.disconnect()).await
}

#[tauri::command]
fn get_snapshot(state: State<'_, Service>) -> Result<Snapshot, AppError> {
    state.snapshot()
}

#[tauri::command]
async fn execute_command(
    request: CommandRequest,
    state: State<'_, Service>,
) -> Result<CommandResult, AppError> {
    let service = state.inner().clone();
    blocking(move || service.execute(request)).await
}

#[tauri::command]
fn preview_command(
    request: CommandRequest,
    state: State<'_, Service>,
) -> Result<Preview, AppError> {
    state.preview(request)
}

#[tauri::command]
fn clear_logs(state: State<'_, Service>) -> Result<(), AppError> {
    state.clear_logs()
}

#[tauri::command]
fn set_simulation_card(present: bool, state: State<'_, Service>) -> Result<(), AppError> {
    state.set_simulation_card(present)
}

#[tauri::command]
fn simulate_next_card(state: State<'_, Service>) -> Result<(), AppError> {
    state.simulate_next_card()
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| AppError::new("internal_error", "Background task could not finish"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Service::default())
        .invoke_handler(tauri::generate_handler![
            list_ports,
            connect_device,
            disconnect_device,
            get_snapshot,
            execute_command,
            preview_command,
            clear_logs,
            set_simulation_card,
            simulate_next_card,
            log_export::log_export_directory,
            log_export::save_log_export
        ])
        .build(tauri::generate_context!())
        .expect("Unable to initialize DF-01 Studio")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                let _ = app.state::<Service>().disconnect();
            }
        });
}
