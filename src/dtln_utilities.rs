// FFI Wrappers and raw interfaces to DTLN engine.
use std::fs::File;
use std::io::Result;
use std::path::Path;
use wav::Header;

use crate::dtln_engine::{dtln_create, dtln_denoise, DtlnEngine};

pub fn write_pcm32_to_wav(samples: Vec<f32>, filename: &str, audiorate: u32) -> Result<()> {
    // Convert to s16
    let header = Header::new(wav::WAV_FORMAT_IEEE_FLOAT, 1, audiorate, 32);
    let mut writer = File::create(Path::new(filename))?;
    wav::write(header, &wav::BitDepth::ThirtyTwoFloat(samples), &mut writer)?;
    Ok(())
}

pub fn read_wav_to_pcm32(input: &str, samples: &mut Vec<f32>) -> Result<u32> {
    samples.clear();
    let mut inp_file = File::open(Path::new(input))?;

    let (header, data) = wav::read(&mut inp_file)?;
    let data = data.try_into_sixteen().unwrap();

    samples.reserve(data.len());

    // The sample clips are only 16 bit mono.
    assert_eq!(header.bits_per_sample, 16);
    assert_eq!(header.channel_count, 1);

    // Convert 16 bit pcm samples in data to 32-bit float
    for sample in data.iter() {
        let mut fsample = *sample as f32 / std::u16::MAX as f32;
        if fsample > 1.0 {
            fsample = 1.0;
        }
        if fsample < -1.0 {
            fsample = -1.0;
        }
        samples.push(fsample);
    }

    Ok(header.sampling_rate)
}

const WASM_AUDIO_BLOCK_SIZE: usize = 512;

#[allow(non_camel_case_types)]
#[repr(C)]
struct audio_buffer {
    data: [f32; WASM_AUDIO_BLOCK_SIZE],
}

#[repr(C)]
struct wasm_denoiser {
    engine: DtlnEngine,
    audio_buffer: audio_buffer,
}

fn wasm_denoiser_from_id(id: u32) -> &'static mut wasm_denoiser {
    let ptr = id as usize as *mut wasm_denoiser;
    assert!(!ptr.is_null(), "Engine not found for {}", id);
    unsafe { &mut *ptr }
}

/**
 * Create a new DtlnEngine and return a unique id for it.
 */
pub fn dtln_create_global() -> u32 {
    let engine = dtln_create();
    let Some(engine) = engine else {
        panic!("Failed to create DtlnEngine");
    };

    let handle = Box::new(wasm_denoiser {
        engine,
        audio_buffer: audio_buffer {
            data: [0.0; WASM_AUDIO_BLOCK_SIZE],
        },
    });

    let ptr = Box::into_raw(handle);
    ptr as usize as u32
}

pub fn dtln_destroy_global(id: u32) {
    let ptr = id as usize as *mut wasm_denoiser;
    if ptr.is_null() {
        return;
    }

    unsafe {
        drop(Box::from_raw(ptr));
    }
}

pub fn dtln_get_audio_buffer_raw_ptr(id: u32) -> *const f32 {
    wasm_denoiser_from_id(id).audio_buffer.data.as_ptr()
}

/**
 * Denoise a block of samples.
 * @param id The unique id of the engine to use.
 */
pub fn dtln_denoise_global(id: u32) -> Result<()> {
    let denoiser = wasm_denoiser_from_id(id);
    let input = denoiser.audio_buffer.data;

    if dtln_denoise(&mut denoiser.engine, &input, &mut denoiser.audio_buffer.data).is_ok() {
        Ok(())
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "Failed to denoise",
        ))
    }
}
