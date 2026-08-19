/* @ts-self-types="./metro_sim_wasm.d.ts" */

export class Engine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_engine_free(ptr, 0);
    }
    /**
     * Evaluates into the internal buffer and copies into `out` (a JS-owned
     * Float32Array view of length >= MAX_VEHICLES*8). Returns vehicle count.
     * @param {number} date_yyyymmdd
     * @param {number} sec_of_day
     * @param {Float32Array} out
     * @returns {number}
     */
    evaluate(date_yyyymmdd, sec_of_day, out) {
        var ptr0 = passArrayF32ToWasm0(out, wasm.__wbindgen_malloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.engine_evaluate(this.__wbg_ptr, date_yyyymmdd, sec_of_day, ptr0, len0, out);
        return ret >>> 0;
    }
    /**
     * True if the most recent `evaluate()` call hit `MAX_VEHICLES` and
     * dropped vehicles (contract §3) — call right after `evaluate()`, before
     * any other call that might re-evaluate the world.
     * @returns {boolean}
     */
    last_truncated() {
        const ret = wasm.engine_last_truncated(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {Uint8Array} cache_bytes
     */
    constructor(cache_bytes) {
        const ptr0 = passArray8ToWasm0(cache_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.engine_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        EngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * `RoutePlan` as JSON, or `"null"` for a structurally invalid request
     * (bad route/station index). A well-formed request that simply does not
     * connect comes back as a real plan with `unreachable: true` — the two
     * are different answers and the UI says different things for each.
     *
     * Nine parameters is past clippy's threshold, and accepted here: this is
     * ONE UI-rate call per submit, and introducing a second serialization
     * boundary just to pack the arguments would cost more than it saves.
     * NOTE this is the FIRST `too_many_arguments` allow in this crate — the
     * design spec claimed an existing precedent, and there wasn't one.
     * @param {number} from_route_idx
     * @param {number} from_station_idx
     * @param {number} to_route_idx
     * @param {number} to_station_idx
     * @param {number} date_yyyymmdd
     * @param {number} sec_of_day
     * @param {number} max_transfers
     * @param {number} max_wait_s
     * @param {number} transfer_buffer_s
     * @returns {string}
     */
    plan_route_json(from_route_idx, from_station_idx, to_route_idx, to_station_idx, date_yyyymmdd, sec_of_day, max_transfers, max_wait_s, transfer_buffer_s) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_plan_route_json(this.__wbg_ptr, from_route_idx, from_station_idx, to_route_idx, to_station_idx, date_yyyymmdd, sec_of_day, max_transfers, max_wait_s, transfer_buffer_s);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * `RunDetail` as JSON, or `"null"` when the run is not live at that time.
     * @param {number} run_idx
     * @param {number} date_yyyymmdd
     * @param {number} sec_of_day
     * @returns {string}
     */
    run_detail_json(run_idx, date_yyyymmdd, sec_of_day) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_run_detail_json(this.__wbg_ptr, run_idx, date_yyyymmdd, sec_of_day);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * `StationBoard` as JSON, or `"null"` for unknown route/station indices.
     * @param {number} route_idx
     * @param {number} station_idx
     * @param {number} date_yyyymmdd
     * @param {number} sec_of_day
     * @param {number} limit
     * @returns {string}
     */
    station_board_json(route_idx, station_idx, date_yyyymmdd, sec_of_day, limit) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_station_board_json(this.__wbg_ptr, route_idx, station_idx, date_yyyymmdd, sec_of_day, limit);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * All stations with ENU positions, as JSON. Fetched once after init.
     * @returns {string}
     */
    stations_json() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_stations_json(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * ValidationSummary as JSON (stations/patterns/runs/services/feed_version).
     * @returns {string}
     */
    validation_json() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_validation_json(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) Engine.prototype[Symbol.dispose] = Engine.prototype.free;

/**
 * @returns {number}
 */
export function max_vehicles() {
    const ret = wasm.max_vehicles();
    return ret >>> 0;
}

/**
 * Layout constants mirrored in src/sim/protocol.ts.
 * @returns {number}
 */
export function vehicle_stride() {
    const ret = wasm.vehicle_stride();
    return ret >>> 0;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_92b29b0548f8b746: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_copy_to_typed_array_4db0cbe2cc60dbee: function(arg0, arg1, arg2) {
            new Uint8Array(arg2.buffer, arg2.byteOffset, arg2.byteLength).set(getArrayU8FromWasm0(arg0, arg1));
        },
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./metro_sim_wasm_bg.js": import0,
    };
}

const EngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_engine_free(ptr, 1));

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('metro_sim_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
