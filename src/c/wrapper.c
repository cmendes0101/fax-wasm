/**
 * wrapper.c — Thin C wrapper around spandsp for WASM.
 *
 * Exposes two handle-based APIs:
 *   fax_audio_*  — G.711 pass-through fax (caller feeds 16-bit LPCM @ 8 kHz)
 *   fax_t38_*    — T.38 fax (caller feeds raw IFP packets after UDPTL unframing)
 *
 * Both write the received TIFF to Emscripten MEMFS at a caller-specified path.
 */

#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

#define SPANDSP_EXPOSE_INTERNAL_STRUCTURES
#include <spandsp.h>

/* ------------------------------------------------------------------ */
/* Shared types                                                        */
/* ------------------------------------------------------------------ */

typedef struct {
    int completed;
    int pages;
    int result_code;
    char remote_ident[64];
} fax_result_t;

/* ------------------------------------------------------------------ */
/* Phase-E handler (called by spandsp when the fax session completes)  */
/* ------------------------------------------------------------------ */

static void phase_e_handler(void *user_data, int result)
{
    fax_result_t *r = (fax_result_t *)user_data;
    r->completed = 1;
    r->result_code = result;
}

/* ------------------------------------------------------------------ */
/* G.711 audio pass-through API                                        */
/* ------------------------------------------------------------------ */

typedef struct {
    fax_state_t *fax;
    fax_result_t result;
    char out_path[256];
} audio_handle_t;

EMSCRIPTEN_KEEPALIVE
void *fax_audio_create(const char *out_path, int calling_party)
{
    audio_handle_t *h = (audio_handle_t *)calloc(1, sizeof(audio_handle_t));
    if (!h) return NULL;

    strncpy(h->out_path, out_path, sizeof(h->out_path) - 1);

    h->fax = fax_init(NULL, calling_party ? TRUE : FALSE);
    if (!h->fax) {
        free(h);
        return NULL;
    }

    t30_state_t *t30 = fax_get_t30_state(h->fax);

    t30_set_rx_file(t30, h->out_path, -1);

    t30_set_phase_e_handler(t30, phase_e_handler, &h->result);

    t30_set_supported_modems(t30,
        T30_SUPPORT_V27TER | T30_SUPPORT_V29 | T30_SUPPORT_V17);

    t30_set_ecm_capability(t30, TRUE);

    return h;
}

EMSCRIPTEN_KEEPALIVE
int fax_audio_rx(void *handle, const int16_t *pcm, int num_samples)
{
    audio_handle_t *h = (audio_handle_t *)handle;
    if (!h || !h->fax) return -1;

    fax_rx(h->fax, (int16_t *)pcm, num_samples);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int fax_audio_finish(void *handle)
{
    audio_handle_t *h = (audio_handle_t *)handle;
    if (!h || !h->fax) return -1;

    return h->result.completed ? h->result.pages : 0;
}

EMSCRIPTEN_KEEPALIVE
int fax_audio_get_pages(void *handle)
{
    audio_handle_t *h = (audio_handle_t *)handle;
    if (!h) return 0;
    t30_state_t *t30 = fax_get_t30_state(h->fax);
    t30_stats_t stats;
    t30_get_transfer_statistics(t30, &stats);
    return stats.pages_rx;
}

EMSCRIPTEN_KEEPALIVE
const char *fax_audio_get_remote_ident(void *handle)
{
    audio_handle_t *h = (audio_handle_t *)handle;
    if (!h || !h->fax) return "";
    t30_state_t *t30 = fax_get_t30_state(h->fax);
    const char *ident = t30_get_rx_ident(t30);
    return ident ? ident : "";
}

EMSCRIPTEN_KEEPALIVE
int fax_audio_is_complete(void *handle)
{
    audio_handle_t *h = (audio_handle_t *)handle;
    if (!h) return 0;
    return h->result.completed;
}

EMSCRIPTEN_KEEPALIVE
void fax_audio_destroy(void *handle)
{
    audio_handle_t *h = (audio_handle_t *)handle;
    if (!h) return;
    if (h->fax) {
        fax_release(h->fax);
        fax_free(h->fax);
    }
    free(h);
}

/* ------------------------------------------------------------------ */
/* T.38 IFP API                                                        */
/* ------------------------------------------------------------------ */

typedef struct {
    t38_terminal_state_t *t38;
    fax_result_t result;
    char out_path[256];
} t38_handle_t;

/*
 * spandsp's t38_core_init() short-circuits with NULL when tx_packet_handler
 * is NULL, which makes t38_terminal_init() return NULL even though we only
 * ever consume IFP packets (receive-only decoder). Hand it a no-op stub so
 * the terminal initializes; we never actually send anything.
 */
static int t38_tx_packet_noop(t38_core_state_t *t,
                              void *user_data,
                              const uint8_t *buf,
                              int len,
                              int count)
{
    (void)t;
    (void)user_data;
    (void)buf;
    (void)len;
    (void)count;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
void *fax_t38_create(const char *out_path)
{
    t38_handle_t *h = (t38_handle_t *)calloc(1, sizeof(t38_handle_t));
    if (!h) return NULL;

    strncpy(h->out_path, out_path, sizeof(h->out_path) - 1);

    h->t38 = t38_terminal_init(NULL, FALSE, t38_tx_packet_noop, h);
    if (!h->t38) {
        free(h);
        return NULL;
    }

    t30_state_t *t30 = t38_terminal_get_t30_state(h->t38);

    t30_set_rx_file(t30, h->out_path, -1);

    t30_set_phase_e_handler(t30, phase_e_handler, &h->result);

    t30_set_supported_modems(t30,
        T30_SUPPORT_V27TER | T30_SUPPORT_V29 | T30_SUPPORT_V17);

    t30_set_ecm_capability(t30, TRUE);

    return h;
}

EMSCRIPTEN_KEEPALIVE
int fax_t38_rx_ifp(void *handle, const uint8_t *ifp, int len, int seq_no)
{
    t38_handle_t *h = (t38_handle_t *)handle;
    if (!h || !h->t38) return -1;

    t38_core_state_t *core = t38_terminal_get_t38_core_state(h->t38);
    t38_core_rx_ifp_packet(core, ifp, len, seq_no);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int fax_t38_finish(void *handle)
{
    t38_handle_t *h = (t38_handle_t *)handle;
    if (!h || !h->t38) return -1;

    return h->result.completed ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int fax_t38_get_pages(void *handle)
{
    t38_handle_t *h = (t38_handle_t *)handle;
    if (!h || !h->t38) return 0;
    t30_state_t *t30 = t38_terminal_get_t30_state(h->t38);
    t30_stats_t stats;
    t30_get_transfer_statistics(t30, &stats);
    return stats.pages_rx;
}

EMSCRIPTEN_KEEPALIVE
const char *fax_t38_get_remote_ident(void *handle)
{
    t38_handle_t *h = (t38_handle_t *)handle;
    if (!h || !h->t38) return "";
    t30_state_t *t30 = t38_terminal_get_t30_state(h->t38);
    const char *ident = t30_get_rx_ident(t30);
    return ident ? ident : "";
}

EMSCRIPTEN_KEEPALIVE
int fax_t38_is_complete(void *handle)
{
    t38_handle_t *h = (t38_handle_t *)handle;
    if (!h) return 0;
    return h->result.completed;
}

EMSCRIPTEN_KEEPALIVE
void fax_t38_destroy(void *handle)
{
    t38_handle_t *h = (t38_handle_t *)handle;
    if (!h) return;
    if (h->t38) {
        t38_terminal_release(h->t38);
        t38_terminal_free(h->t38);
    }
    free(h);
}
