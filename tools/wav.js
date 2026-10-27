// wav.js
// ------------------------------------------------------------
// Minimal WAV file reading and writing for Node (used by the test tools,
// not by the web app). Written by hand so the project needs no packages.
//
// A WAV file is a small header followed by the raw samples:
//   "RIFF" header → "fmt " chunk (format, channels, sample rate, bits)
//                 → "data" chunk (the samples themselves)
// Samples in this code are numbers between −1 and +1.
// ------------------------------------------------------------

import { readFileSync, writeFileSync } from 'node:fs';

// Write mono samples (−1..+1) as a 16-bit PCM WAV file.
export function writeWav(filePath, samples, sampleRate) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // --- header (44 bytes) ---
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);       // size of everything after this field
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);                 // fmt chunk size
  buffer.writeUInt16LE(1, 20);                  // format 1 = PCM (plain integers)
  buffer.writeUInt16LE(1, 22);                  // 1 channel (mono)
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // bytes per second
  buffer.writeUInt16LE(bytesPerSample, 32);     // bytes per frame
  buffer.writeUInt16LE(16, 34);                 // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  // --- samples: scale −1..+1 to the 16-bit range −32768..32767 ---
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i])); // clip anything too loud
    buffer.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), 44 + i * 2);
  }

  writeFileSync(filePath, buffer);
}

// Read a WAV file. Supports 16-bit and 24-bit PCM and 32-bit float,
// mono or stereo (stereo is averaged to mono).
// Returns { sampleRate, samples } with samples as a Float32Array (−1..+1).
export function readWav(filePath) {
  const buffer = readFileSync(filePath);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${filePath} is not a WAV file`);
  }

  let format, channels, sampleRate, bitsPerSample, dataStart, dataSize;

  // Walk through the chunks. Real recordings often contain extra chunks
  // (like "LIST" metadata) that we skip.
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = buffer.readUInt16LE(body);
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);
      // Format 0xFFFE ("extensible") stores the real format later in the chunk.
      if (format === 0xfffe) format = buffer.readUInt16LE(body + 24);
    } else if (id === 'data') {
      dataStart = body;
      dataSize = Math.min(size, buffer.length - body);
    }
    offset = body + size + (size % 2); // chunks are padded to an even size
  }

  if (dataStart === undefined || !sampleRate) throw new Error(`${filePath}: missing fmt or data chunk`);

  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(dataSize / (bytesPerSample * channels));
  const samples = new Float32Array(frameCount);

  // Read one sample and convert it to −1..+1.
  const readOne = (pos) => {
    if (format === 3 && bitsPerSample === 32) return buffer.readFloatLE(pos);
    if (format === 1 && bitsPerSample === 16) return buffer.readInt16LE(pos) / 32768;
    if (format === 1 && bitsPerSample === 24) return buffer.readIntLE(pos, 3) / 8388608;
    throw new Error(`${filePath}: unsupported WAV format ${format} / ${bitsPerSample}-bit`);
  };

  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += readOne(dataStart + (i * channels + c) * bytesPerSample);
    }
    samples[i] = sum / channels;
  }

  return { sampleRate, samples };
}
