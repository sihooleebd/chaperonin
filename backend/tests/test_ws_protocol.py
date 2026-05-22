import unittest

from chaperonin.ws_protocol import accept_key, encode_text_frame, decode_frames


class TestWsProtocol(unittest.TestCase):
    def test_accept_key_rfc6455(self):
        self.assertEqual(accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
                         "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")

    def test_encode_text(self):
        self.assertEqual(encode_text_frame("Hello"), bytes([0x81, 0x05]) + b"Hello")

    def test_encode_long(self):
        frame = encode_text_frame("x" * 200)
        self.assertEqual(frame[1], 126)
        self.assertEqual(int.from_bytes(frame[2:4], "big"), 200)

    def test_decode_masked(self):
        raw = bytes([0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58])
        msgs, rest = decode_frames(raw)
        self.assertEqual(msgs, [("text", "Hello")])
        self.assertEqual(rest, b"")

    def test_partial_frame_kept(self):
        raw = bytes([0x81, 0x85, 0x37])
        msgs, rest = decode_frames(raw)
        self.assertEqual(msgs, [])
        self.assertEqual(rest, raw)

    def test_close(self):
        msgs, _ = decode_frames(bytes([0x88, 0x80, 0, 0, 0, 0]))
        self.assertEqual(msgs, [("close", "")])


if __name__ == "__main__":
    unittest.main()
