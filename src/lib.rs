pub mod constants;
pub mod dtln_engine;
#[cfg(not(target_os = "emscripten"))]
pub mod dtln_processor;
pub mod dtln_utilities;
pub mod tflite;

#[cfg(not(target_os = "emscripten"))]
use dtln_processor::DtlnDeferredProcessor;
#[cfg(not(target_os = "emscripten"))]
use dtln_processor::DtlnProcessEngine;
#[cfg(not(target_os = "emscripten"))]
use neon::prelude::*;
#[cfg(not(target_os = "emscripten"))]
use neon::types::buffer::TypedArray;
#[cfg(not(target_os = "emscripten"))]
use std::io::Result;
#[cfg(not(target_os = "emscripten"))]
use std::sync::{Arc, Mutex};

#[cfg(not(target_os = "emscripten"))]
fn dtln_create_napi(mut cx: FunctionContext) -> JsResult<JsBox<Arc<Mutex<DtlnDeferredProcessor>>>> {
    let dtln_processor = DtlnDeferredProcessor::new();
    let Ok(dtln_processor) = dtln_processor else {
        return cx.throw_error("Failed to create DtlnDeferredProcessor");
    };

    Ok(cx.boxed(Arc::new(Mutex::new(dtln_processor))))
}

#[cfg(not(target_os = "emscripten"))]
fn dtln_stop_napi(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let dtln_processor = cx.argument::<JsBox<Arc<Mutex<DtlnDeferredProcessor>>>>(0)?;
    dtln_processor.lock().unwrap().stop();
    Ok(cx.undefined())
}

/**
* Denoise the samples.
*
* @param {Float32Array} samples - The samples to denoise.
* @param {Float32Array} output - The denoised samples.

* @returns {boolean} - True if the processing thread is backed up.
*/
#[cfg(not(target_os = "emscripten"))]
fn dtln_denoise_napi(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    if cx.len() != 3 {
        return cx.throw_error("Invalid number of arguments, expected <engine: JsBox, samples: Float32Array, output: Float32Array>");
    }

    let processor_starved;

    let result: Result<()> = {
        let dtln_processor = cx.argument::<JsBox<Arc<Mutex<DtlnDeferredProcessor>>>>(0)?;

        let samples = cx.argument::<JsTypedArray<f32>>(1).unwrap();
        let mut output = cx.argument::<JsTypedArray<f32>>(2).unwrap();

        let lock = cx.lock();
        let samples_slice = samples.try_borrow(&lock).unwrap();
        let mut output_slice = output.try_borrow_mut(&lock).unwrap();

        // RefMut has to be passed up the entire chain, and I'd rather not let
        // it leak further into the dtln_denoise abstraction. Generically
        // operating on an &mut [f32] is better, so copying here is our best option.
        let denoise_result = dtln_processor
            .lock()
            .unwrap()
            .denoise(&samples_slice)
            .map_err(|e| panic!("Error in dtln_denoise: {}", e))
            .unwrap();

        processor_starved = denoise_result.processor_starved;

        output_slice[..denoise_result.samples.len()].copy_from_slice(&denoise_result.samples);
        Ok(())
    };

    if result.is_ok() {
        Ok(cx.boolean(processor_starved))
    } else {
        cx.throw_error("Error in dtln_denoise")
    }
}

#[cfg(not(target_os = "emscripten"))]
#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("dtln_denoise", dtln_denoise_napi)?;
    cx.export_function("dtln_create", dtln_create_napi)?;
    cx.export_function("dtln_stop", dtln_stop_napi)?;

    Ok(())
}
