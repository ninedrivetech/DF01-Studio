const HEADER: u8 = 0x7f;
const MIN_LENGTH: usize = 3;
const MAX_LENGTH: usize = u8::MAX as usize;
const MAX_PARAMETERS: usize = MAX_LENGTH - MIN_LENGTH;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Frame {
    pub address: u8,
    pub command: u8,
    pub parameters: Vec<u8>,
}

pub fn encode(frame: &Frame) -> Result<Vec<u8>, String> {
    if frame.parameters.len() > MAX_PARAMETERS {
        return Err(format!(
            "Frame has {} parameter bytes; the maximum is {MAX_PARAMETERS}",
            frame.parameters.len()
        ));
    }

    // LEN counts address, command, parameters and checksum (not the length byte).
    let length = (MIN_LENGTH + frame.parameters.len()) as u8;
    let mut checksum = length ^ frame.address ^ frame.command;
    for &parameter in &frame.parameters {
        checksum ^= parameter;
    }
    let mut bytes = Vec::with_capacity(8 + frame.parameters.len() * 2);
    bytes.push(HEADER);
    // The firmware table requires stuffing every byte following the header.
    for byte in [length, frame.address, frame.command]
        .into_iter()
        .chain(frame.parameters.iter().copied())
        .chain(std::iter::once(checksum))
    {
        bytes.push(byte);
        if byte == HEADER {
            bytes.push(HEADER);
        }
    }
    Ok(bytes)
}

#[derive(Debug, Default)]
pub struct Decoder {
    buffer: Vec<u8>,
}

enum ParseResult {
    Complete(Frame, usize),
    Invalid(String, usize),
    Incomplete,
}

impl Decoder {
    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }

    pub fn clear(&mut self) {
        self.buffer.clear();
    }

    pub fn push(&mut self, bytes: &[u8]) -> Vec<Result<Frame, String>> {
        self.buffer.extend_from_slice(bytes);
        let mut results = Vec::new();
        let mut consumed = 0;

        while consumed < self.buffer.len() {
            let Some(header_offset) = self.buffer[consumed..]
                .iter()
                .position(|&byte| byte == HEADER || byte == 0xfd)
            else {
                consumed = self.buffer.len();
                break;
            };
            consumed += header_offset;
            // U13T output shares the UART. Skip the complete binary text frame,
            // including any 7F bytes in its payload, before parsing module replies.
            if self.buffer[consumed] == 0xfd {
                if self.buffer.len() - consumed < 3 {
                    break;
                }
                let length =
                    u16::from_be_bytes([self.buffer[consumed + 1], self.buffer[consumed + 2]])
                        as usize;
                if !(2..=18).contains(&length) {
                    consumed += 1;
                    continue;
                }
                if self.buffer.len() - consumed < length + 3 {
                    break;
                }
                consumed += length + 3;
                continue;
            }
            match parse_candidate(&self.buffer[consumed..]) {
                ParseResult::Complete(frame, length) => {
                    results.push(Ok(frame));
                    consumed += length;
                }
                ParseResult::Invalid(error, length) => {
                    results.push(Err(error));
                    consumed += length;
                }
                ParseResult::Incomplete => break,
            }
        }

        self.buffer.drain(..consumed);
        results
    }
}

fn parse_candidate(bytes: &[u8]) -> ParseResult {
    let mut logical = Vec::new();
    let mut position = 1;
    loop {
        let Some(&byte) = bytes.get(position) else {
            return ParseResult::Incomplete;
        };
        if byte == HEADER {
            let Some(&escaped) = bytes.get(position + 1) else {
                return ParseResult::Incomplete;
            };
            if escaped != HEADER {
                // This byte can be the beginning of the next valid frame.
                return ParseResult::Invalid(
                    format!("Unescaped 0x7F at logical byte {}", logical.len() + 1),
                    position,
                );
            }
            position += 1;
        }
        logical.push(byte);
        position += 1;
        if logical.len() == 1 && !(MIN_LENGTH..=MAX_LENGTH).contains(&(byte as usize)) {
            return ParseResult::Invalid(format!("Invalid frame length: 0x{byte:02X}"), 1);
        }
        if logical.len() == logical[0] as usize + 1 {
            break;
        }
    }

    let length = logical[0] as usize;
    let checksum = logical[..length].iter().fold(0, |sum, byte| sum ^ byte);
    let received_checksum = logical[length];
    if checksum != received_checksum {
        return ParseResult::Invalid(
            format!(
                "Checksum mismatch: expected 0x{checksum:02X}, received 0x{received_checksum:02X}"
            ),
            position,
        );
    }

    ParseResult::Complete(
        Frame {
            address: logical[1],
            command: logical[2],
            parameters: logical[3..length].to_vec(),
        },
        position,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(input: &str) -> Vec<u8> {
        let compact: String = input.split_whitespace().collect();
        assert_eq!(compact.len() % 2, 0);
        compact
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect()
    }

    fn frame(command: u8, parameters: &[u8]) -> Frame {
        Frame {
            address: 0,
            command,
            parameters: parameters.to_vec(),
        }
    }

    #[test]
    fn voice_frames_with_embedded_headers_do_not_corrupt_module_replies() {
        let expected = frame(0xb2, &[0, 0xe8, 3, 0xc8, 0]);
        let mut wire = hex("FD 00 07 01 01 7F 03 00 10 13");
        wire.extend(encode(&expected).unwrap());
        for split in 0..=wire.len() {
            let mut decoder = Decoder::default();
            let mut result = decoder.push(&wire[..split]);
            result.extend(decoder.push(&wire[split..]));
            assert_eq!(result, vec![Ok(expected.clone())]);
        }
    }

    #[test]
    fn manual_examples_match_wire_bytes() {
        let examples = [
            (frame(0x10, &[]), "7F03001013"),
            (
                frame(0x90, &hex("00 0400 E045AFAB")),
                "7F0A0090000400E045AFAB3F",
            ),
            (
                frame(0x12, &hex("01 D3C5C1E9BFC6BCBC0000000000000000")),
                "7F14001201D3C5C1E9BFC6BCBC000000000000000040",
            ),
            (
                frame(0x92, &hex("00 0400 E045AFAB")),
                "7F0A0092000400E045AFAB3D",
            ),
            (frame(0x11, &[1]), "7F0400110114"),
            (
                frame(
                    0x91,
                    &hex("00 0400 E045AFAB D3C5C1E9BFC6BCBC0000000000000000"),
                ),
                "7F1A0091000400E045AFABD3C5C1E9BFC6BCBC000000000000000069",
            ),
            (
                frame(0x2e, &hex("02 0C 01 00000001 231254")),
                "7F0D002E020C010000000123125448",
            ),
            (frame(0xae, &[0]), "7F0400AE00AA"),
            (frame(0x2f, &hex("E8 03")), "7F05002FE803C1"),
            (frame(0xaf, &[0]), "7F0400AF00AB"),
            (frame(0x30, &[7]), "7F0400300733"),
            (frame(0xb0, &[0, 7]), "7F0500B00007B2"),
            (frame(0x31, &[]), "7F03003132"),
            (frame(0x33, &[60]), "7F0400333C0B"),
            (frame(0xb3, &[0, 60]), "7F0500B3003C8A"),
            (frame(0xb3, &[0xfe, 60]), "7F0500B3FE3C74"),
            (frame(0x32, &hex("C4 09 E8 03")), "7F070032C409E80313"),
            (
                frame(0xb1, &hex("00 00 00C20100 03 04 01000000 FFFFFFFFFFFF FFFFFFFFFFFF 0000 07 C409 E803 01 3C")),
                "7F2400B1000000C20100030401000000FFFFFFFFFFFFFFFFFFFFFFFF000007C409E803013C4C",
            ),
            (
                frame(0xb1, &hex("00 00 00C20100 03 04 01000000 FFFFFFFFFFFF FFFFFFFFFFFF 0000 07 E803 C800 00")),
                "7F2300B1000000C20100030401000000FFFFFFFFFFFFFFFFFFFFFFFF000007E803C8000073",
            ),
            (
                frame(
                    0xb1,
                    &hex("00 00 00C20100 00 01 00000001 FFFFFFFFFFFF FFFFFFFFFFFF 0000 04"),
                ),
                "7F1E00B1000000C20100000100000001FFFFFFFFFFFFFFFFFFFFFFFF00000468",
            ),
        ];
        for (expected, wire_hex) in examples {
            let wire = hex(wire_hex);
            assert_eq!(encode(&expected).unwrap(), wire);
            assert_eq!(Decoder::default().push(&wire), vec![Ok(expected)]);
        }
    }

    #[test]
    fn all_parameter_values_round_trip_with_stuffed_header_fields() {
        let all_bytes: Vec<u8> = (0..=255).collect();
        for address in [0, HEADER, 255] {
            for command in [0, HEADER, 255] {
                for parameters in all_bytes.chunks(MAX_PARAMETERS) {
                    let expected = Frame {
                        address,
                        command,
                        parameters: parameters.to_vec(),
                    };
                    let wire = encode(&expected).unwrap();
                    let checksum = parameters.iter().fold(
                        (MIN_LENGTH + parameters.len()) as u8 ^ address ^ command,
                        |sum, byte| sum ^ byte,
                    );
                    let escaped_count = parameters.iter().filter(|&&b| b == HEADER).count()
                        + usize::from(address == HEADER)
                        + usize::from(command == HEADER)
                        + usize::from(checksum == HEADER)
                        + usize::from(MIN_LENGTH + parameters.len() == HEADER as usize);
                    assert_eq!(wire.len(), parameters.len() + escaped_count + 5);
                    assert_eq!(Decoder::default().push(&wire), vec![Ok(expected)]);
                }
            }
        }
    }

    #[test]
    fn escapes_all_bytes_after_header_and_uses_unescaped_checksum() {
        let expected = Frame {
            address: HEADER,
            command: HEADER,
            parameters: vec![HEADER, HEADER],
        };
        assert_eq!(
            encode(&expected).unwrap(),
            hex("7F 05 7F7F 7F7F 7F7F 7F7F 05")
        );
        let checksum_header = frame(0x7c, &[]);
        assert_eq!(encode(&checksum_header).unwrap(), hex("7F 03 00 7C 7F7F"));
        assert_eq!(
            Decoder::default().push(&encode(&checksum_header).unwrap()),
            vec![Ok(checksum_header)]
        );
    }

    #[test]
    fn decodes_every_possible_two_part_split() {
        let expected = Frame {
            address: HEADER,
            command: HEADER,
            parameters: vec![0, HEADER, 1, HEADER, HEADER, 255],
        };
        let wire = encode(&expected).unwrap();
        for split in 0..=wire.len() {
            let mut decoder = Decoder::default();
            let mut received = decoder.push(&wire[..split]);
            received.extend(decoder.push(&wire[split..]));
            assert_eq!(received, vec![Ok(expected.clone())], "split {split}");
            assert!(decoder.buffer.is_empty());
        }
    }

    #[test]
    fn decodes_one_byte_at_a_time_and_coalesced_frames_with_noise() {
        let expected = [
            frame(0x10, &[]),
            frame(0x91, &[0, HEADER, 4]),
            frame(0xae, &[0]),
        ];
        let mut wire = vec![0, 1, 2, 0xff];
        for item in &expected {
            wire.extend(encode(item).unwrap());
            wire.extend([0x20, 0x40]);
        }
        let results: Vec<_> = expected.into_iter().map(Ok).collect();
        assert_eq!(Decoder::default().push(&wire), results);
        let mut decoder = Decoder::default();
        let mut received = Vec::new();
        for byte in wire {
            received.extend(decoder.push(&[byte]));
            assert!(decoder.push(&[]).is_empty());
        }
        assert_eq!(received, results);
        assert!(decoder.buffer.is_empty());
    }

    #[test]
    fn recovers_from_invalid_lengths_escapes_and_checksums() {
        let expected = frame(0x10, &[]);
        let valid = encode(&expected).unwrap();
        let bad_frames = [
            hex("7F 02 00 10"),
            hex("7F 04 00 11 7F 01"),
            hex("7F 04 00 11"),
            hex("7F 03 00 10 00"),
            hex("7F 03 00 10"),
            hex("7F 05 00 11 7F7F 04 00"),
        ];
        for bad in bad_frames {
            let mut wire = bad.clone();
            wire.extend_from_slice(&valid);
            let received = Decoder::default().push(&wire);
            assert!(received.iter().any(Result::is_err), "bad frame {bad:02X?}");
            let frames: Vec<_> = received.into_iter().filter_map(Result::ok).collect();
            assert_eq!(frames, vec![expected.clone()], "bad frame {bad:02X?}");
        }
    }

    #[test]
    fn escaped_parameter_bytes_are_not_resynchronization_candidates() {
        let mut wire = encode(&frame(0x11, &[HEADER, 4, 0, 0x10])).unwrap();
        *wire.last_mut().unwrap() ^= 1;
        let expected = frame(0x90, &[0, 4, 0, 1, 2, 3, 4]);
        wire.extend(encode(&expected).unwrap());
        let received = Decoder::default().push(&wire);
        assert_eq!(received.len(), 2);
        assert!(received[0].is_err());
        assert_eq!(received[1], Ok(expected));
    }

    #[test]
    fn maximum_frame_length_counts_original_parameter_bytes() {
        let expected = frame(0x12, &[HEADER; MAX_PARAMETERS]);
        let wire = encode(&expected).unwrap();
        assert_eq!(wire[1], MAX_LENGTH as u8);
        assert_eq!(wire.len(), 509);
        let mut decoder = Decoder::default();
        for byte in &wire[..wire.len() - 1] {
            assert!(decoder.push(&[*byte]).is_empty());
            assert!(decoder.buffer.len() <= 508);
        }
        assert_eq!(decoder.push(&wire[wire.len() - 1..]), vec![Ok(expected)]);
        assert!(encode(&frame(0x12, &[0; MAX_PARAMETERS + 1])).is_err());
    }

    #[test]
    fn length_byte_is_stuffed_when_it_equals_header() {
        let expected = frame(0x12, &[0; 124]);
        let wire = encode(&expected).unwrap();
        assert_eq!(&wire[..3], &[0x7f, 0x7f, 0x7f]);
        assert_eq!(Decoder::default().push(&wire), vec![Ok(expected)]);
    }

    #[test]
    fn clear_discards_partial_frame_before_new_connection() {
        let mut decoder = Decoder::default();
        assert!(decoder.is_empty());
        assert!(decoder.push(&hex("7F 7E 00 11 7F")).is_empty());
        assert!(!decoder.is_empty());
        decoder.clear();
        assert!(decoder.is_empty());
        let expected = frame(0x10, &[]);
        assert_eq!(
            decoder.push(&encode(&expected).unwrap()),
            vec![Ok(expected)]
        );
    }
}
