PROJ := libfvad
DIST_DIR := dist

SOURCES := \
	src/signal_processing/energy.c \
	src/signal_processing/division_operations.c \
	src/signal_processing/get_scaling_square.c \
	src/signal_processing/resample_48khz.c \
	src/signal_processing/resample_by_2_internal.c \
	src/signal_processing/resample_fractional.c \
	src/signal_processing/spl_inl.c \
	src/vad/vad_core.c \
	src/vad/vad_filterbank.c \
	src/vad/vad_gmm.c \
	src/vad/vad_sp.c \
	src/fvad.c

EXPORTED_FUNCTIONS := '["_malloc","_free","_fvad_new","_fvad_free","_fvad_reset","_fvad_set_mode","_fvad_set_sample_rate","_fvad_process"]'
EXPORTED_RUNTIME_METHODS := '["cwrap"]'

EMCCFLAGS := \
	-O3 \
	-Iinclude \
	-Isrc \
	-s ALLOW_MEMORY_GROWTH=1 \
	-s FILESYSTEM=0 \
	-s MODULARIZE=1 \
	-s EXPORT_ES6=1 \
	-s EXPORT_NAME=createLibFvadModule \
	-s EXPORTED_FUNCTIONS=$(EXPORTED_FUNCTIONS) \
	-s EXPORTED_RUNTIME_METHODS=$(EXPORTED_RUNTIME_METHODS)

.PHONY: all clean

all: $(DIST_DIR)/$(PROJ).js $(DIST_DIR)/$(PROJ).wasm

$(DIST_DIR)/$(PROJ).js $(DIST_DIR)/$(PROJ).wasm: $(SOURCES)
	mkdir -p $(DIST_DIR)
	emcc $(EMCCFLAGS) -o $(DIST_DIR)/$(PROJ).js $(SOURCES)

clean:
	rm -f $(DIST_DIR)/$(PROJ).js $(DIST_DIR)/$(PROJ).wasm
