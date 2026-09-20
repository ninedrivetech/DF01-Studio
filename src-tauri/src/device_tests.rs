use super::*;
use std::io;

#[derive(Default)]
struct MockState {
    incoming: VecDeque<u8>,
    response_on_write: Option<Vec<u8>>,
    writes: Vec<Vec<u8>>,
    baud_attempts: Vec<u32>,
    timeouts: Vec<Duration>,
    write_timeout: Option<Duration>,
    fail_baud: bool,
}

struct MockSerial {
    state: Arc<Mutex<MockState>>,
    read_chunk: usize,
    baud: u32,
    timeout: Duration,
}

impl Read for MockSerial {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        let mut state = self.state.lock().unwrap();
        let count = bytes.len().min(self.read_chunk).min(state.incoming.len());
        for byte in &mut bytes[..count] {
            *byte = state.incoming.pop_front().unwrap();
        }
        if count == 0 {
            drop(state);
            thread::sleep(Duration::from_millis(1));
            return Err(io::ErrorKind::TimedOut.into());
        }
        Ok(count)
    }
}

impl Write for MockSerial {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let mut state = self.state.lock().unwrap();
        state.writes.push(bytes.to_vec());
        state.write_timeout = Some(self.timeout);
        if let Some(response) = state.response_on_write.take() {
            state.incoming.extend(response);
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl SerialPort for MockSerial {
    fn name(&self) -> Option<String> {
        Some("scripted-test-port".into())
    }
    fn baud_rate(&self) -> serialport::Result<u32> {
        Ok(self.baud)
    }
    fn data_bits(&self) -> serialport::Result<serialport::DataBits> {
        Ok(serialport::DataBits::Eight)
    }
    fn flow_control(&self) -> serialport::Result<serialport::FlowControl> {
        Ok(serialport::FlowControl::None)
    }
    fn parity(&self) -> serialport::Result<serialport::Parity> {
        Ok(serialport::Parity::None)
    }
    fn stop_bits(&self) -> serialport::Result<serialport::StopBits> {
        Ok(serialport::StopBits::One)
    }
    fn timeout(&self) -> Duration {
        self.timeout
    }
    fn set_baud_rate(&mut self, baud_rate: u32) -> serialport::Result<()> {
        let mut state = self.state.lock().unwrap();
        state.baud_attempts.push(baud_rate);
        if state.fail_baud {
            return Err(serialport::Error::new(
                serialport::ErrorKind::Unknown,
                "scripted baud change failure",
            ));
        }
        self.baud = baud_rate;
        Ok(())
    }
    fn set_data_bits(&mut self, _: serialport::DataBits) -> serialport::Result<()> {
        Ok(())
    }
    fn set_flow_control(&mut self, _: serialport::FlowControl) -> serialport::Result<()> {
        Ok(())
    }
    fn set_parity(&mut self, _: serialport::Parity) -> serialport::Result<()> {
        Ok(())
    }
    fn set_stop_bits(&mut self, _: serialport::StopBits) -> serialport::Result<()> {
        Ok(())
    }
    fn set_timeout(&mut self, timeout: Duration) -> serialport::Result<()> {
        self.state.lock().unwrap().timeouts.push(timeout);
        self.timeout = timeout;
        Ok(())
    }
    fn write_request_to_send(&mut self, _: bool) -> serialport::Result<()> {
        Ok(())
    }
    fn write_data_terminal_ready(&mut self, _: bool) -> serialport::Result<()> {
        Ok(())
    }
    fn read_clear_to_send(&mut self) -> serialport::Result<bool> {
        Ok(true)
    }
    fn read_data_set_ready(&mut self) -> serialport::Result<bool> {
        Ok(true)
    }
    fn read_ring_indicator(&mut self) -> serialport::Result<bool> {
        Ok(false)
    }
    fn read_carrier_detect(&mut self) -> serialport::Result<bool> {
        Ok(true)
    }
    fn bytes_to_read(&self) -> serialport::Result<u32> {
        Ok(self.state.lock().unwrap().incoming.len() as u32)
    }
    fn bytes_to_write(&self) -> serialport::Result<u32> {
        Ok(0)
    }
    fn clear(&self, buffer: serialport::ClearBuffer) -> serialport::Result<()> {
        if matches!(
            buffer,
            serialport::ClearBuffer::Input | serialport::ClearBuffer::All
        ) {
            self.state.lock().unwrap().incoming.clear();
        }
        Ok(())
    }
    fn try_clone(&self) -> serialport::Result<Box<dyn SerialPort>> {
        Ok(Box::new(Self {
            state: self.state.clone(),
            read_chunk: self.read_chunk,
            baud: self.baud,
            timeout: self.timeout,
        }))
    }
    fn set_break(&self) -> serialport::Result<()> {
        Ok(())
    }
    fn clear_break(&self) -> serialport::Result<()> {
        Ok(())
    }
}

fn mock_transport(response: Vec<u8>, read_chunk: usize) -> (Transport, Arc<Mutex<MockState>>) {
    let state = Arc::new(Mutex::new(MockState {
        response_on_write: Some(response),
        ..Default::default()
    }));
    let port = MockSerial {
        state: state.clone(),
        read_chunk,
        baud: 115200,
        timeout: Duration::from_millis(20),
    };
    (Transport::Serial(Box::new(port)), state)
}

fn request(command: u8, parameters: Vec<u8>) -> CommandRequest {
    CommandRequest {
        command,
        parameters,
        confirmed_write: false,
    }
}

fn response(address: u8, command: u8, parameters: &[u8]) -> Vec<u8> {
    encode(&Frame {
        address,
        command,
        parameters: parameters.to_vec(),
    })
    .unwrap()
}

fn transaction(
    transport: &mut Transport,
    decoder: &mut Decoder,
    core: &Mutex<Core>,
    request: &CommandRequest,
) -> Result<CommandResult, AppError> {
    transact(
        transport,
        decoder,
        &AtomicBool::new(false),
        core,
        request,
        100,
    )
}

#[test]
fn conflicting_automatic_block_read_never_sends_or_misattributes_trailer_data() {
    let (mut transport, state) = mock_transport(response(0, 0x91, &[0; 23]), 512);
    let core = Mutex::new(Core {
        auto_mode: Some(2),
        auto_block: Some(3),
        ..Core::default()
    });
    let error = transaction(
        &mut transport,
        &mut Decoder::default(),
        &core,
        &request(0x11, vec![1]),
    )
    .unwrap_err();
    assert_eq!(error.code, "automatic_read_conflict");
    assert!(state.lock().unwrap().writes.is_empty());
    assert!(core.lock().unwrap().last_card.is_none());
    core.lock().unwrap().auto_block = Some(1);
    assert_eq!(
        transaction(
            &mut transport,
            &mut Decoder::default(),
            &core,
            &request(0x11, vec![1])
        )
        .unwrap()
        .card
        .unwrap()
        .block,
        Some(1)
    );
}

#[test]
fn serial_response_can_arrive_one_byte_at_a_time_with_escaped_data() {
    let mut parameters = vec![0, 4, 0, 0xe0, 0x45, 0xaf, 0xab];
    parameters.extend([0x7f; 16]);
    let (mut transport, state) = mock_transport(response(0, 0x91, &parameters), 1);
    let core = Mutex::new(Core::default());
    let result = transaction(
        &mut transport,
        &mut Decoder::default(),
        &core,
        &request(0x11, vec![1]),
    )
    .unwrap();
    assert_eq!(result.status, 0);
    let card = result.card.unwrap();
    assert_eq!(card.block, Some(1));
    assert_eq!(card.uid_hex, "ABAF45E0");
    assert_eq!(card.data.unwrap(), vec![0x7f; 16]);
    assert_eq!(
        state.lock().unwrap().writes,
        vec![vec![0x7f, 4, 0, 0x11, 1, 0x14]]
    );
}

#[test]
fn serial_reads_page_6a_with_escaped_checksum_and_page_255() {
    for page in [0x6A, 255] {
        let mut parameters = vec![0, 0x44, 0, 1, 2, 3, 4];
        parameters.extend([page; 16]);
        let (mut transport, state) = mock_transport(response(0, 0x91, &parameters), 512);
        let req = request(0x11, vec![page]);
        assert!(validate(&req).is_ok());
        let result = transaction(
            &mut transport,
            &mut Decoder::default(),
            &Mutex::new(Core::default()),
            &req,
        )
        .unwrap();
        assert_eq!(result.card.unwrap().block, Some(page));
        let writes = &state.lock().unwrap().writes;
        assert_eq!(writes.len(), 1);
        assert_eq!(
            writes[0],
            if page == 0x6A {
                vec![0x7F, 4, 0, 0x11, 0x6A, 0x7F, 0x7F]
            } else {
                vec![0x7F, 4, 0, 0x11, 255, 0xEA]
            }
        );
    }
}

#[test]
fn serial_ignores_bad_checksum_bad_length_and_malformed_payload_before_valid_response() {
    let card = [0, 4, 0, 1, 2, 3, 4];
    let mut corrupted = response(0, 0x90, &card);
    *corrupted.last_mut().unwrap() ^= 1;
    let mut incoming = vec![0x7f, 2];
    incoming.extend(corrupted);
    incoming.extend(response(0, 0x90, &[0, 4]));
    incoming.extend(response(0, 0x90, &card));
    let (mut transport, state) = mock_transport(incoming, 512);
    let core = Mutex::new(Core::default());
    let result = transaction(
        &mut transport,
        &mut Decoder::default(),
        &core,
        &request(0x10, vec![]),
    )
    .unwrap();
    assert_eq!(result.card.unwrap().uid_hex, "04030201");
    assert_eq!(core.lock().unwrap().stats.errors, 3);
    assert_eq!(state.lock().unwrap().writes.len(), 1);
}

#[test]
fn serial_ignores_valid_response_from_another_address() {
    let mut incoming = response(1, 0x90, &[0, 4, 0, 9, 9, 9, 9]);
    incoming.extend(response(0, 0x90, &[0, 4, 0, 1, 2, 3, 4]));
    let (mut transport, _) = mock_transport(incoming, 512);
    let core = Mutex::new(Core::default());
    let result = transaction(
        &mut transport,
        &mut Decoder::default(),
        &core,
        &request(0x10, vec![]),
    )
    .unwrap();
    assert_eq!(result.card.unwrap().uid_hex, "04030201");
    let core = core.lock().unwrap();
    assert_eq!(core.stats.rx, 1);
    assert_eq!(core.last_card.as_ref().unwrap().uid_hex, "04030201");
}

#[test]
fn mutation_timeout_is_uncertain_and_never_retransmits() {
    let (mut transport, state) = mock_transport(vec![], 512);
    let core = Mutex::new(Core::default());
    let mut parameters = vec![1];
    parameters.extend([0x55; 16]);
    let result = transaction(
        &mut transport,
        &mut Decoder::default(),
        &core,
        &request(0x12, parameters),
    );
    assert_eq!(result.unwrap_err().code, "uncertain_result");
    assert_eq!(state.lock().unwrap().writes.len(), 1);
    assert_eq!(core.lock().unwrap().stats.tx, 1);
}

#[test]
fn gain_uses_actual_ack_value_and_failed_settings_preserve_saved_configuration() {
    let (mut transport, _) = mock_transport(response(0, 0xb0, &[0, 6]), 512);
    let core = Mutex::new(Core {
        configuration: Some(DeviceConfiguration::default()),
        ..Core::default()
    });
    transaction(
        &mut transport,
        &mut Decoder::default(),
        &core,
        &request(0x30, vec![7]),
    )
    .unwrap();
    assert_eq!(
        core.lock()
            .unwrap()
            .configuration
            .as_ref()
            .unwrap()
            .antenna_gain,
        6
    );
    let (mut transport, _) = mock_transport(response(0, 0xaf, &[0xfe]), 512);
    let result = transaction(
        &mut transport,
        &mut Decoder::default(),
        &core,
        &request(0x2f, vec![0xe8, 3]),
    )
    .unwrap();
    assert_eq!(result.status, 0xfe);
    assert_eq!(
        core.lock()
            .unwrap()
            .configuration
            .as_ref()
            .unwrap()
            .reset_ms,
        0
    );
}

#[test]
fn configuration_read_parses_offsets_and_redacts_keys_with_split_escaped_bytes() {
    let mut parameters = vec![0, 0x7f, 0, 0xc2, 1, 0, 2, 0x7f, 0, 0, 0, 1];
    parameters.extend([0x7f; 6]);
    parameters.extend([0xab; 6]);
    parameters.extend([0xe8, 3, 7]);
    let (mut transport, state) = mock_transport(response(0x7f, 0xb1, &parameters), 1);
    let mut initial = Core::default();
    initial.connection.address = 0x7f;
    let core = Mutex::new(initial);
    let result = transaction(
        &mut transport,
        &mut Decoder::default(),
        &core,
        &request(0x31, vec![]),
    )
    .unwrap();
    assert_eq!(result.data, parameters);
    let core = core.lock().unwrap();
    let configuration = core.configuration.as_ref().unwrap();
    assert_eq!(configuration.module_id, 0x7f);
    assert_eq!(configuration.baud_rate, 115200);
    assert_eq!(configuration.auto_initial_value, vec![0, 0, 0, 1]);
    assert_eq!(configuration.key_a, vec![0x7f; 6]);
    assert_eq!(configuration.key_b, vec![0xab; 6]);
    assert_eq!(configuration.reset_ms, 1000);
    assert_eq!(configuration.antenna_gain, 7);
    assert_eq!(core.auto_mode, Some(2));
    assert_eq!(core.auto_block, Some(0x7f));
    assert!(core.logs.iter().all(|log| !log.hex.contains("AB AB")));
    assert_eq!(state.lock().unwrap().writes.len(), 1);
}

#[test]
fn configuration_versions_accept_new_mode_without_enabling_unsupported_commands() {
    let base = vec![
        0, 0, 0, 0xc2, 1, 0, 3, 4, 1, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 0, 0, 7,
    ];
    for (extension, product_mode) in [
        (vec![], None),
        (vec![0xe8, 3, 0xc8, 0], None),
        (vec![0xe8, 3, 0xc8, 0, 0], Some(0)),
        (vec![0xe8, 3, 0xc8, 0, 1], Some(1)),
        (vec![0xc4, 9, 0xe8, 3, 1, 60], Some(1)),
    ] {
        let core = Mutex::new(Core::default());
        let mut parameters = base.clone();
        parameters.extend(extension);
        let (mut transport, _) = mock_transport(response(0, 0xb1, &parameters), 1);
        transaction(
            &mut transport,
            &mut Decoder::default(),
            &core,
            &request(0x31, vec![]),
        )
        .unwrap();
        let state = core.lock().unwrap();
        let saved = state.configuration.as_ref().unwrap();
        assert_eq!(saved.product_mode, product_mode);
        assert_eq!(saved.initial_duty_percent, parameters.get(32).copied());
        assert_eq!(saved.auto_mode, 3);
        assert_eq!(saved.auto_block, 4);
        assert_eq!(saved.key_a, vec![255; 6]);
        assert!(state.logs.iter().all(|log| !log.hex.contains("FF FF")));
    }
    for length in [28, 29, 30, 34] {
        let mut parameters = base.clone();
        parameters.resize(length, 0);
        let core = Mutex::new(Core::default());
        assert!(record_frame(
            &core,
            Ok(Frame {
                address: 0,
                command: 0xb1,
                parameters
            }),
            None
        )
        .is_none());
        assert!(core.lock().unwrap().configuration.is_none());
    }
    assert!(validate(&request(0x2e, vec![3, 13, 4, 1, 0, 0, 0, 0x23, 0x12, 0x54])).is_ok());
    assert!(validate(&request(0x32, vec![0xe8, 3, 0xc8, 0])).is_ok());
}

#[test]
fn voice_settings_support_both_products_and_only_success_changes_saved_values() {
    let req = request(0x2e, vec![3, 13, 4, 5, 1, 9, 8, 0x23, 0x12, 0x54]);
    for product_mode in [None, Some(2)] {
        let core = Mutex::new(Core {
            configuration: Some(DeviceConfiguration {
                product_mode,
                ..DeviceConfiguration::default()
            }),
            ..Core::default()
        });
        let (mut transport, port) = mock_transport(response(0, 0xae, &[0]), 1);
        assert_eq!(
            transaction(&mut transport, &mut Decoder::default(), &core, &req)
                .unwrap_err()
                .code,
            "unsupported_product"
        );
        assert!(port.lock().unwrap().writes.is_empty());
    }
    for product_mode in [Some(0), Some(1)] {
        let core = Mutex::new(Core {
            configuration: Some(DeviceConfiguration {
                product_mode,
                ..DeviceConfiguration::default()
            }),
            ..Core::default()
        });
        let (mut transport, port) = mock_transport(response(0, 0xae, &[0]), 1);
        assert_eq!(
            transaction(&mut transport, &mut Decoder::default(), &core, &req)
                .unwrap()
                .status,
            0
        );
        assert_eq!(
            port.lock().unwrap().writes,
            vec![encode(&Frame {
                address: 0,
                command: 0x2e,
                parameters: req.parameters.clone()
            })
            .unwrap()]
        );
        {
            let state = core.lock().unwrap();
            let saved = state.configuration.as_ref().unwrap();
            assert_eq!(state.auto_mode, Some(3));
            assert_eq!(saved.auto_mode, 3);
            assert_eq!(saved.auto_initial_value, vec![5, 1, 9, 8]);
        }
        let (mut transport, _) = mock_transport(response(0, 0xae, &[0xfe]), 1);
        let rejected = request(0x2e, vec![3, 13, 8, 1, 0, 9, 8, 0x23, 0x12, 0x54]);
        assert_eq!(
            transaction(&mut transport, &mut Decoder::default(), &core, &rejected)
                .unwrap()
                .status,
            0xfe
        );
        let state = core.lock().unwrap();
        let saved = state.configuration.as_ref().unwrap();
        assert_eq!(saved.auto_block, 4);
        assert_eq!(saved.auto_initial_value, vec![5, 1, 9, 8]);
        assert_eq!(saved.product_mode, product_mode);
    }
}

#[test]
fn duty_ack_validates_success_and_preserves_configuration_on_failure() {
    let core = Mutex::new(Core {
        configuration: Some(DeviceConfiguration::default()),
        ..Core::default()
    });
    let req = request(0x33, vec![75]);
    for (reply, expected) in [(vec![0, 75], 75), (vec![0xfe, 60], 75)] {
        let (mut transport, _) = mock_transport(response(0, 0xb3, &reply), 1);
        transaction(&mut transport, &mut Decoder::default(), &core, &req).unwrap();
        assert_eq!(
            core.lock()
                .unwrap()
                .configuration
                .as_ref()
                .unwrap()
                .initial_duty_percent,
            Some(expected)
        );
    }
    for parameters in [vec![0], vec![0, 101], vec![0, 60, 0]] {
        assert!(record_frame(
            &core,
            Ok(Frame {
                address: 0,
                command: 0xb3,
                parameters
            }),
            Some(&req)
        )
        .is_none());
    }
    core.lock()
        .unwrap()
        .configuration
        .as_mut()
        .unwrap()
        .initial_duty_percent = None;
    let (mut transport, port) = mock_transport(response(0, 0xb3, &[0, 75]), 1);
    assert_eq!(
        transaction(&mut transport, &mut Decoder::default(), &core, &req)
            .unwrap_err()
            .code,
        "unsupported_firmware"
    );
    assert!(port.lock().unwrap().writes.is_empty());
}

#[test]
fn startup_settings_require_product_readback_and_a_valid_success_ack() {
    let req = request(0x32, vec![0xe8, 3, 0xc8, 0]);
    let core = Mutex::new(Core::default());
    let (mut transport, state) = mock_transport(response(0, 0xb2, &[0, 0xe8, 3, 0xc8, 0]), 1);
    assert_eq!(
        transaction(&mut transport, &mut Decoder::default(), &core, &req)
            .unwrap_err()
            .code,
        "unsupported_product"
    );
    assert!(state.lock().unwrap().writes.is_empty());
    core.lock().unwrap().configuration = Some(DeviceConfiguration {
        product_mode: Some(1),
        ramp_ms: Some(500),
        startup_delay_ms: Some(500),
        ..DeviceConfiguration::default()
    });
    transaction(&mut transport, &mut Decoder::default(), &core, &req).unwrap();
    assert_eq!(
        core.lock().unwrap().configuration.as_ref().unwrap().ramp_ms,
        Some(1000)
    );
    let (mut transport, _) = mock_transport(response(0, 0xb2, &[0xfe, 0xe8, 3, 0xc8, 0]), 1);
    assert_eq!(
        transaction(
            &mut transport,
            &mut Decoder::default(),
            &core,
            &request(0x32, vec![0xd0, 7, 0xf4, 1])
        )
        .unwrap()
        .status,
        0xfe
    );
    assert_eq!(
        core.lock().unwrap().configuration.as_ref().unwrap().ramp_ms,
        Some(1000)
    );
    assert!(record_frame(
        &core,
        Ok(Frame {
            address: 0,
            command: 0xb2,
            parameters: vec![0, 1, 0, 0, 0]
        }),
        Some(&req)
    )
    .is_none());
}

#[test]
fn malformed_extended_configuration_never_replaces_saved_values() {
    let parameters = vec![
        0, 0, 0, 0xc2, 1, 0, 3, 4, 1, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 0, 0, 7, 0xc4, 9, 0xe8, 3, 1, 60,
    ];
    let core = Mutex::new(Core::default());
    assert!(record_frame(
        &core,
        Ok(Frame {
            address: 0,
            command: 0xb1,
            parameters: parameters.clone()
        }),
        None
    )
    .is_some());
    for (offset, value) in [
        (2, 1),
        (8, 2),
        (9, 2),
        (27, 0),
        (28, 0),
        (30, 255),
        (31, 2),
        (32, 101),
    ] {
        let mut invalid = parameters.clone();
        invalid[offset] = value;
        // Force a below-minimum ramp rather than a different valid millisecond value.
        if offset == 27 {
            invalid[28] = 0;
        }
        if offset == 28 {
            invalid[27] = 199;
        }
        assert!(
            record_frame(
                &core,
                Ok(Frame {
                    address: 0,
                    command: 0xb1,
                    parameters: invalid
                }),
                None
            )
            .is_none(),
            "offset {offset}"
        );
        let state = core.lock().unwrap();
        let saved = state.configuration.as_ref().unwrap();
        assert_eq!(saved.ramp_ms, Some(2500));
        assert_eq!(saved.initial_duty_percent, Some(60));
        assert_eq!(saved.auto_initial_value, vec![1, 0, 0, 0]);
    }
    // Reserved auto_value bytes remain opaque in non-voice modes.
    let mut reserved = parameters;
    reserved[6] = 2;
    reserved[8] = 255;
    reserved[9] = 255;
    assert!(record_frame(
        &core,
        Ok(Frame {
            address: 0,
            command: 0xb1,
            parameters: reserved
        }),
        None
    )
    .is_some());
}

#[test]
fn malformed_configuration_and_gain_success_never_update_saved_values() {
    let core = Mutex::new(Core {
        configuration: Some(DeviceConfiguration::default()),
        ..Core::default()
    });
    for (command, parameters) in [(0xb1, vec![0; 26]), (0xb0, vec![0]), (0xb0, vec![0, 8])] {
        assert!(record_frame(
            &core,
            Ok(Frame {
                address: 0,
                command,
                parameters
            }),
            None
        )
        .is_none());
    }
    assert_eq!(
        core.lock()
            .unwrap()
            .configuration
            .as_ref()
            .unwrap()
            .antenna_gain,
        7
    );
    let (mut transport, state) = mock_transport(vec![], 512);
    let error = transaction(
        &mut transport,
        &mut Decoder::default(),
        &core,
        &request(0x31, vec![]),
    )
    .unwrap_err();
    assert_eq!(error.code, "timeout");
    assert_eq!(state.lock().unwrap().writes.len(), 1);
}

#[test]
fn queued_same_command_response_is_drained_before_transmitting() {
    let (mut transport, state) = mock_transport(response(0, 0x90, &[0, 4, 0, 1, 2, 3, 4]), 512);
    state
        .lock()
        .unwrap()
        .incoming
        .extend(response(0, 0x90, &[0, 4, 0, 9, 9, 9, 9]));
    let core = Mutex::new(Core::default());
    let result = transaction(
        &mut transport,
        &mut Decoder::default(),
        &core,
        &request(0x10, vec![]),
    )
    .unwrap();
    assert_eq!(result.card.unwrap().uid_hex, "04030201");
    assert_eq!(state.lock().unwrap().writes.len(), 1);
    let core = core.lock().unwrap();
    let directions: Vec<_> = core.logs.iter().map(|log| log.direction.as_str()).collect();
    assert_eq!(directions, vec!["rx", "tx", "rx"]);
}

#[test]
fn residual_partial_frame_is_cleared_after_quiet_window() {
    let (mut transport, _) = mock_transport(response(0, 0x90, &[0, 4, 0, 1, 2, 3, 4]), 512);
    let core = Mutex::new(Core::default());
    let mut decoder = Decoder::default();
    assert!(decoder.push(&[0x7f, 0x7e, 0, 0x91, 0x7f]).is_empty());
    let result = transaction(&mut transport, &mut decoder, &core, &request(0x10, vec![])).unwrap();
    assert_eq!(result.card.unwrap().uid_hex, "04030201");
    assert!(decoder.is_empty());
    assert!(core
        .lock()
        .unwrap()
        .logs
        .iter()
        .any(|log| log.direction == "system" && log.level == "warning"));
}

#[test]
fn automatic_mode_ack_applies_new_block_before_report_in_same_read() {
    let mut incoming = response(0, 0xae, &[0]);
    let mut parameters = vec![0, 4, 0, 1, 2, 3, 4];
    parameters.extend([0x66; 16]);
    incoming.extend(response(0, 0x91, &parameters));
    let (mut transport, _) = mock_transport(incoming, 512);
    let state = Core {
        auto_mode: Some(2),
        auto_block: Some(1),
        ..Core::default()
    };
    let core = Mutex::new(state);
    let result = transaction(
        &mut transport,
        &mut Decoder::default(),
        &core,
        &request(0x2e, vec![2, 12, 6, 0, 0, 0, 0, 0x23, 0x12, 0x54]),
    )
    .unwrap();
    assert_eq!(result.command, 0x2e);
    assert_eq!(result.status, 0);
    let core = core.lock().unwrap();
    assert_eq!(core.auto_block, Some(6));
    assert_eq!(core.last_card.as_ref().unwrap().block, Some(6));
    assert_eq!(core.last_card.as_ref().unwrap().data, Some(vec![0x66; 16]));
}

#[test]
fn address_ack_applies_new_address_before_report_in_same_read() {
    let mut incoming = response(0x21, 0xad, &[0]);
    incoming.extend(response(0x21, 0x90, &[0, 4, 0, 1, 2, 3, 4]));
    let (mut transport, _) = mock_transport(incoming, 512);
    let core = Mutex::new(Core::default());
    let result = transaction(
        &mut transport,
        &mut Decoder::default(),
        &core,
        &request(0x2d, vec![0x21, 0x37, 0x21, 0x56]),
    )
    .unwrap();
    assert_eq!(result.command, 0x2d);
    assert_eq!(result.status, 0);
    let core = core.lock().unwrap();
    assert_eq!(core.connection.address, 0x21);
    assert_eq!(core.stats.rx, 2);
    assert_eq!(core.last_card.as_ref().unwrap().uid_hex, "04030201");
}

#[test]
fn slow_baud_write_timeout_covers_escaped_frame_and_restores_read_timeout() {
    let (mut transport, state) = mock_transport(response(0, 0x92, &[0, 4, 0, 1, 2, 3, 4]), 512);
    let mut initial = Core::default();
    initial.connection.baud_rate = 2400;
    let core = Mutex::new(initial);
    let mut parameters = vec![6];
    parameters.extend([0x7f; 16]);
    let result = transaction(
        &mut transport,
        &mut Decoder::default(),
        &core,
        &request(0x12, parameters),
    )
    .unwrap();
    assert_eq!(result.status, 0);
    let state = state.lock().unwrap();
    assert_eq!(state.writes.len(), 1);
    let wire_time_ms = (state.writes[0].len() as u64 * 10 * 1000).div_ceil(2400);
    let write_timeout = state.write_timeout.unwrap();
    assert!(wire_time_ms > 100);
    assert!(write_timeout >= Duration::from_millis(wire_time_ms + 100));
    assert_eq!(
        state.timeouts,
        vec![write_timeout, Duration::from_millis(20)]
    );
}
