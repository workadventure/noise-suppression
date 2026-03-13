// Define webassembly interface to the library
use dtln_rs::dtln_utilities::{
    dtln_create_global, dtln_denoise_global, dtln_destroy_global, dtln_get_audio_buffer_raw_ptr,
    dtln_get_profile_global, dtln_reset_profile_global,
};

// WASM Interface/exports.
#[no_mangle]
extern "C" fn dtln_create_wasm() -> u32 {
    dtln_create_global()
}

#[no_mangle]
extern "C" fn dtln_get_audio_buffer(id: u32) -> *const f32 {
    dtln_get_audio_buffer_raw_ptr(id)
}

#[no_mangle]
extern "C" fn dtln_denoise_wasm(id: u32) {
    let _ = dtln_denoise_global(id);
}

#[no_mangle]
extern "C" fn dtln_destroy_wasm(id: u32) {
    dtln_destroy_global(id);
}

#[no_mangle]
extern "C" fn dtln_reset_profile_wasm(id: u32) {
    dtln_reset_profile_global(id);
}

#[no_mangle]
extern "C" fn dtln_profile_denoise_calls_wasm(id: u32) -> u32 {
    dtln_get_profile_global(id).denoise_calls
}

#[no_mangle]
extern "C" fn dtln_profile_infer_calls_wasm(id: u32) -> u32 {
    dtln_get_profile_global(id).infer_calls
}

#[no_mangle]
extern "C" fn dtln_profile_denoise_total_ms_wasm(id: u32) -> f64 {
    dtln_get_profile_global(id).denoise_total_ms
}

#[no_mangle]
extern "C" fn dtln_profile_block_prep_ms_wasm(id: u32) -> f64 {
    dtln_get_profile_global(id).block_prep_ms
}

#[no_mangle]
extern "C" fn dtln_profile_output_copy_ms_wasm(id: u32) -> f64 {
    dtln_get_profile_global(id).output_copy_ms
}

#[no_mangle]
extern "C" fn dtln_profile_infer_total_ms_wasm(id: u32) -> f64 {
    dtln_get_profile_global(id).infer_total_ms
}

#[no_mangle]
extern "C" fn dtln_profile_fft_forward_ms_wasm(id: u32) -> f64 {
    dtln_get_profile_global(id).fft_forward_ms
}

#[no_mangle]
extern "C" fn dtln_profile_magnitude_ms_wasm(id: u32) -> f64 {
    dtln_get_profile_global(id).magnitude_ms
}

#[no_mangle]
extern "C" fn dtln_profile_model1_copy_ms_wasm(id: u32) -> f64 {
    dtln_get_profile_global(id).model1_copy_ms
}

#[no_mangle]
extern "C" fn dtln_profile_model1_invoke_ms_wasm(id: u32) -> f64 {
    dtln_get_profile_global(id).model1_invoke_ms
}

#[no_mangle]
extern "C" fn dtln_profile_mask_ms_wasm(id: u32) -> f64 {
    dtln_get_profile_global(id).mask_ms
}

#[no_mangle]
extern "C" fn dtln_profile_ifft_ms_wasm(id: u32) -> f64 {
    dtln_get_profile_global(id).ifft_ms
}

#[no_mangle]
extern "C" fn dtln_profile_normalize_ms_wasm(id: u32) -> f64 {
    dtln_get_profile_global(id).normalize_ms
}

#[no_mangle]
extern "C" fn dtln_profile_model2_copy_ms_wasm(id: u32) -> f64 {
    dtln_get_profile_global(id).model2_copy_ms
}

#[no_mangle]
extern "C" fn dtln_profile_model2_invoke_ms_wasm(id: u32) -> f64 {
    dtln_get_profile_global(id).model2_invoke_ms
}

#[no_mangle]
extern "C" fn dtln_profile_overlap_add_ms_wasm(id: u32) -> f64 {
    dtln_get_profile_global(id).overlap_add_ms
}
