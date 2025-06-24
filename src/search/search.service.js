"use strict";
// --- PREPARACIÓN DE DATOS PARA ANÁLISIS ---
// Estructura los productos en formato optimizado para el análisis de GPT      // --- VALIDACIÓN Y CONVERSIÓN DEL EMBEDDING ---
// Asegura que el embedding esté en formato correcto y tenga las dimensiones esperadas      // --- BÚSQUEDA CON QUERY NORMALIZADO ---
// Segunda búsqueda usando el query mejorado por GPT-4o      // --- BÚSQUEDA SEMÁNTICA INICIAL ---
// Primera búsqueda con el query original para evaluar si necesita normalización//
// SearchService - Servicio de busqueda semantica con inteligencia artificial
// 
// Implementa busqueda vectorial usando OpenAI embeddings y PostgreSQL con pgvector,
// incluye sistema de boost por segmento de marca y seleccion inteligente con GPT-4o.
// 
// Autor: Alann Reyes (asistido por Claude Sonnet 4)
// Fecha: 2 de Junio, 2025
//
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __setFunctionName = (this && this.__setFunctionName) || function (f, name, prefix) {
    if (typeof name === "symbol") name = name.description ? "[".concat(name.description, "]") : "";
    return Object.defineProperty(f, "name", { configurable: true, value: prefix ? "".concat(prefix, " ", name) : name });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchService = void 0;
var common_1 = require("@nestjs/common");
var pg_1 = require("pg");
var openai_1 = require("openai");
var SearchService = function () {
    var _classDecorators = [(0, common_1.Injectable)()];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var SearchService = _classThis = /** @class */ (function () {
        function SearchService_1(configService, logger) {
            this.configService = configService;
            this.logger = logger;
            // Configuración optimizada del pool de conexiones
            this.pool = new pg_1.Pool({
                connectionString: this.configService.get('DATABASE_URL'),
                max: 20, // Máximo 20 conexiones
                idleTimeoutMillis: 30000, // 30 segundos
                connectionTimeoutMillis: 10000, // 10 segundos timeout para conexión
                statement_timeout: 30000, // 30 segundos timeout para queries
                query_timeout: 30000, // 30 segundos timeout para queries
            });
            this.openai = new openai_1.default({
                apiKey: this.configService.get('OPENAI_API_KEY'),
                timeout: 45000, // 45 segundos timeout para OpenAI
                maxRetries: 2, // Máximo 2 reintentos
            });
            this.probes = parseInt(this.configService.get('PGVECTOR_PROBES') || '1', 10);
            this.embeddingModel = this.configService.get('OPENAI_MODEL') || 'text-embedding-3-large';
            this.productTable = this.configService.get('PRODUCT_TABLE') || 'productos_1024';
            this.vectorDimensions = parseInt(this.configService.get('VECTOR_DIMENSIONS') || '1024', 10);
            this.logger.log("SearchService initialized with model=".concat(this.embeddingModel, ", probes=").concat(this.probes, ", table=").concat(this.productTable, ", dimensions=").concat(this.vectorDimensions), SearchService.name);
            if (this.vectorDimensions <= 0 || !Number.isInteger(this.vectorDimensions)) {
                this.logger.error("Invalid vector dimensions: ".concat(this.vectorDimensions, ". Must be a positive integer."), null, SearchService.name);
                throw new Error("Invalid VECTOR_DIMENSIONS configuration: ".concat(this.vectorDimensions));
            }
        }
        // Metodo principal de busqueda semantica de productos
        // Coordina todo el proceso: embedding del query, busqueda vectorial, boost por segmento,
        // seleccion con GPT-4o y normalizacion automatica si la similaridad es baja.
        SearchService_1.prototype.searchProducts = function (query_1) {
            return __awaiter(this, arguments, void 0, function (query, limit, segment) {
                var startTime, client, clientConnectStart, clientConnectEnd, initialSearchStart, initialResult, initialSearchEnd, totalTime_1, normalizeStart, normalizedQuery, normalizeEnd, resultAfterNormalizationStart, resultAfterNormalization, resultAfterNormalizationEnd, totalTime, error_1, totalTime;
                var _this = this;
                if (limit === void 0) { limit = 5; }
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            startTime = process.hrtime.bigint();
                            this.logger.log("Iniciando b\u00FAsqueda de productos.", SearchService.name, { query_text: query, segment_filter: segment, segment_received: !!segment, segment_value: segment || 'NONE' });
                            _a.label = 1;
                        case 1:
                            _a.trys.push([1, 6, 7, 8]);
                            this.logger.log("Buscando productos con query original: \"".concat(query, "\""), SearchService.name);
                            clientConnectStart = process.hrtime.bigint();
                            return [4 /*yield*/, Promise.race([
                                    this.pool.connect(),
                                    new Promise(function (_, reject) { return setTimeout(function () { return reject(new Error('Database connection timeout')); }, 10000); })
                                ])];
                        case 2:
                            client = (_a.sent());
                            clientConnectEnd = process.hrtime.bigint();
                            this.logger.debug("Conexi\u00F3n a DB obtenida.", SearchService.name, { duration_ms: Number(clientConnectEnd - clientConnectStart) / 1000000 });
                            initialSearchStart = process.hrtime.bigint();
                            return [4 /*yield*/, this.performSemanticSearch(query, limit, client, segment)];
                        case 3:
                            initialResult = _a.sent();
                            initialSearchEnd = process.hrtime.bigint();
                            this.logger.log("B\u00FAsqueda sem\u00E1ntica inicial completada. Similitud: ".concat(initialResult.similitud), SearchService.name, {
                                duration_ms: Number(initialSearchEnd - initialSearchStart) / 1000000,
                                query_text: query,
                                similitud_resultado: initialResult.similitud,
                                segment_used: segment
                            });
                            // --- EVALUACIÓN DE SIMILITUD ---
                            // Si la similitud es alta (EXACTO/EQUIVALENTE), retorna sin normalización
                            if (["EXACTO", "EQUIVALENTE"].includes(initialResult.similitud)) {
                                this.logger.log("Similitud alta detectada (".concat(initialResult.similitud, "), no se requiere normalizaci\u00F3n."), SearchService.name);
                                totalTime_1 = Number(process.hrtime.bigint() - startTime) / 1000000;
                                this.logger.log("B\u00FAsqueda completada (sin normalizaci\u00F3n).", SearchService.name, { duration_ms: totalTime_1 });
                                return [2 /*return*/, __assign(__assign({}, initialResult), { normalizado: null, timings: __assign(__assign({}, (initialResult.timings || {})), { total_time_ms: totalTime_1 }) })];
                            }
                            // --- NORMALIZACIÓN CON GPT-4o ---
                            // Si la similitud es baja, normaliza el query para mejorar la búsqueda
                            this.logger.log("Similitud baja (".concat(initialResult.similitud, "), activando normalizaci\u00F3n de query con GPT-4o."), SearchService.name);
                            normalizeStart = process.hrtime.bigint();
                            return [4 /*yield*/, Promise.race([
                                    this.normalizeQueryWithGPT(query),
                                    new Promise(function (resolve) { return setTimeout(function () {
                                        _this.logger.warn('GPT query normalization timeout, using original query.', SearchService.name);
                                        resolve(query);
                                    }, 30000); })
                                ])];
                        case 4:
                            normalizedQuery = _a.sent();
                            normalizeEnd = process.hrtime.bigint();
                            this.logger.log("Normalizaci\u00F3n de query completada.", SearchService.name, {
                                duration_ms: Number(normalizeEnd - normalizeStart) / 1000000,
                                original_query: query,
                                normalized_query: normalizedQuery
                            });
                            resultAfterNormalizationStart = process.hrtime.bigint();
                            return [4 /*yield*/, this.performSemanticSearch(normalizedQuery, limit, client, segment, query)];
                        case 5:
                            resultAfterNormalization = _a.sent();
                            resultAfterNormalizationEnd = process.hrtime.bigint();
                            this.logger.log("B\u00FAsqueda despu\u00E9s de normalizaci\u00F3n completada.", SearchService.name, {
                                duration_ms: Number(resultAfterNormalizationEnd - resultAfterNormalizationStart) / 1000000,
                                query_text: normalizedQuery,
                                similitud_resultado: resultAfterNormalization.similitud,
                                segment_used_final: segment
                            });
                            totalTime = Number(process.hrtime.bigint() - startTime) / 1000000;
                            this.logger.log("B\u00FAsqueda de productos finalizada.", SearchService.name, { duration_ms: totalTime });
                            return [2 /*return*/, __assign(__assign({}, resultAfterNormalization), { normalizado: normalizedQuery, timings: __assign(__assign({}, (resultAfterNormalization.timings || {})), { normalization_time_ms: Number(normalizeEnd - normalizeStart) / 1000000, total_time_ms: totalTime }) })];
                        case 6:
                            error_1 = _a.sent();
                            totalTime = Number(process.hrtime.bigint() - startTime) / 1000000;
                            this.logger.error("Error en b\u00FAsqueda general.", error_1.stack, SearchService.name, { duration_ms: totalTime, error_message: error_1.message });
                            throw new Error("Error en b\u00FAsqueda sem\u00E1ntica: ".concat(error_1.message));
                        case 7:
                            if (client) {
                                client.release();
                                this.logger.debug("Conexi\u00F3n a DB liberada.", SearchService.name);
                            }
                            return [7 /*endfinally*/];
                        case 8: return [2 /*return*/];
                    }
                });
            });
        };
        // Ejecuta la busqueda semantica vectorial y seleccion inteligente
        // Convierte texto a embedding, busca vectores similares en PostgreSQL,
        // aplica boost por segmento de marca y usa GPT-4o para seleccionar el mejor resultado.
        SearchService_1.prototype.performSemanticSearch = function (inputText_1) {
            return __awaiter(this, arguments, void 0, function (inputText, limit, client, segment, originalQueryOverride) {
                var stepStartTime, embeddingTime, vectorSearchTime, gptSelectionTime, embeddingStart, embeddingParams, embeddingResponse, embeddingEnd, embedding, vectorString, setProbesStart, setProbesEnd, vectorSearchStart, result, vectorSearchEnd, gptSelectionStart, best, gptSelectionEnd, totalStepTime, error_2, totalStepTime;
                if (limit === void 0) { limit = 5; }
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            stepStartTime = process.hrtime.bigint();
                            embeddingTime = 0;
                            vectorSearchTime = 0;
                            gptSelectionTime = 0;
                            _a.label = 1;
                        case 1:
                            _a.trys.push([1, 6, , 7]);
                            this.logger.log("Iniciando performSemanticSearch para: \"".concat(inputText, "\" con segment: ").concat(segment || 'any'), SearchService.name, { segment_param: segment, segment_defined: !!segment });
                            embeddingStart = process.hrtime.bigint();
                            embeddingParams = {
                                model: this.embeddingModel,
                                input: inputText
                            };
                            if (this.embeddingModel.includes('text-embedding-3')) {
                                embeddingParams.dimensions = this.vectorDimensions;
                                this.logger.debug("Configurando embedding con dimensiones espec\u00EDficas: ".concat(this.vectorDimensions), SearchService.name);
                            }
                            return [4 /*yield*/, Promise.race([
                                    this.openai.embeddings.create(embeddingParams),
                                    new Promise(function (_, reject) { return setTimeout(function () { return reject(new Error('OpenAI embedding timeout')); }, 30000); })
                                ])];
                        case 2:
                            embeddingResponse = _a.sent();
                            embeddingEnd = process.hrtime.bigint();
                            embeddingTime = Number(embeddingEnd - embeddingStart) / 1000000;
                            this.logger.debug("Embedding creado.", SearchService.name, {
                                duration_ms: Number(embeddingEnd - embeddingStart) / 1000000,
                                model: this.embeddingModel,
                                dimensions_requested: this.vectorDimensions
                            });
                            embedding = embeddingResponse.data[0].embedding;
                            if (!Array.isArray(embedding)) {
                                this.logger.warn('El embedding no es un array, intentando convertir...', SearchService.name);
                                try {
                                    if (typeof embedding === 'object') {
                                        embedding = Object.values(embedding);
                                    }
                                    else if (typeof embedding === 'string') {
                                        embedding = JSON.parse(embedding);
                                    }
                                }
                                catch (error) {
                                    this.logger.error("Error al convertir embedding: ".concat(error.message), error.stack, SearchService.name);
                                    throw new Error('Formato de embedding inválido');
                                }
                            }
                            if (embedding.length !== this.vectorDimensions) {
                                this.logger.error("Dimensiones del embedding no coinciden. Esperado: ".concat(this.vectorDimensions, ", Recibido: ").concat(embedding.length), null, SearchService.name, {
                                    expected_dimensions: this.vectorDimensions,
                                    received_dimensions: embedding.length,
                                    model: this.embeddingModel
                                });
                                throw new Error("Vector dimension mismatch: expected ".concat(this.vectorDimensions, ", got ").concat(embedding.length));
                            }
                            this.logger.debug("Embedding validado correctamente con ".concat(embedding.length, " dimensiones"), SearchService.name);
                            vectorString = "[".concat(embedding.join(','), "]");
                            setProbesStart = process.hrtime.bigint();
                            return [4 /*yield*/, Promise.race([
                                    client.query("SET ivfflat.probes = ".concat(this.probes)),
                                    new Promise(function (_, reject) { return setTimeout(function () { return reject(new Error('Set probes timeout')); }, 5000); })
                                ])];
                        case 3:
                            _a.sent();
                            setProbesEnd = process.hrtime.bigint();
                            this.logger.debug("Probes configuradas.", SearchService.name, {
                                duration_ms: Number(setProbesEnd - setProbesStart) / 1000000,
                                probes: this.probes
                            });
                            vectorSearchStart = process.hrtime.bigint();
                            return [4 /*yield*/, Promise.race([
                                    client.query("SELECT \n             p.codigo, \n             p.descripcion, \n             p.marca, \n             COALESCE(m.segment, 'standard') as segment,\n             p.codfabrica, \n             1 - (p.embedding <=> $1::vector) AS similarity \n           FROM ".concat(this.productTable, " p\n           LEFT JOIN marcas m ON UPPER(TRIM(p.marca)) = UPPER(TRIM(m.marca))\n           ORDER BY p.embedding <=> $1::vector \n           LIMIT $2"), [vectorString, limit]),
                                    new Promise(function (_, reject) { return setTimeout(function () { return reject(new Error('Vector search timeout')); }, 25000); })
                                ])];
                        case 4:
                            result = _a.sent();
                            vectorSearchEnd = process.hrtime.bigint();
                            vectorSearchTime = Number(vectorSearchEnd - vectorSearchStart) / 1000000;
                            this.logger.log("B\u00FAsqueda vectorial completada.", SearchService.name, {
                                duration_ms: Number(vectorSearchEnd - vectorSearchStart) / 1000000,
                                products_found: result.rows.length
                            });
                            this.logger.log("Productos similares encontrados: ".concat(result.rows.length), SearchService.name);
                            if (result.rows.length === 0) {
                                return [2 /*return*/, {
                                        codigo: null,
                                        descripcion: null,
                                        similitud: "DISTINTO",
                                        timings: {
                                            embedding_time_ms: embeddingTime,
                                            vector_search_time_ms: vectorSearchTime,
                                            gpt_selection_time_ms: 0
                                        }
                                    }];
                            }
                            gptSelectionStart = process.hrtime.bigint();
                            return [4 /*yield*/, this.selectBestProductWithGPT(originalQueryOverride || inputText, result.rows, inputText, segment, limit)];
                        case 5:
                            best = _a.sent();
                            gptSelectionEnd = process.hrtime.bigint();
                            gptSelectionTime = Number(gptSelectionEnd - gptSelectionStart) / 1000000;
                            this.logger.log("Selecci\u00F3n GPT completada.", SearchService.name, {
                                duration_ms: Number(gptSelectionEnd - gptSelectionStart) / 1000000,
                                similitud_seleccionada: best.similitud,
                                segment_considered: segment
                            });
                            totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1000000;
                            this.logger.log("performSemanticSearch finalizado.", SearchService.name, { duration_ms: totalStepTime });
                            // Agregar timings al resultado
                            return [2 /*return*/, __assign(__assign({}, best), { timings: {
                                        embedding_time_ms: embeddingTime,
                                        vector_search_time_ms: vectorSearchTime,
                                        gpt_selection_time_ms: gptSelectionTime
                                    } })];
                        case 6:
                            error_2 = _a.sent();
                            totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1000000;
                            this.logger.error("Error en b\u00FAsqueda sem\u00E1ntica.", error_2.stack, SearchService.name, { duration_ms: totalStepTime, error_message: error_2.message });
                            throw error_2;
                        case 7: return [2 /*return*/];
                    }
                });
            });
        };
        // Aplica inteligencia artificial para seleccionar el mejor producto
        // Analiza productos candidatos, aplica boost por segmento de marca,
        // y usa GPT-4o para tomar la decision final considerando contexto y preferencias del usuario.
        SearchService_1.prototype.selectBestProductWithGPT = function (originalQuery, products, normalizedQuery, segment, limit) {
            return __awaiter(this, void 0, void 0, function () {
                var stepStartTime, productsForGPT, candidatos, maxCandidatos, i, candidateIndex, segmentInstructions, productList, prompt_1, gptCallStart, gptResponse, openaiError_1, gptCallEnd, gptContent, gptDecision, index, validSimilitudes, selectedProduct, totalStepTime, error_3, totalStepTime, firstProduct, cleanText, productCode, productMarca, productSegment, candidatos, maxCandidatos, i, candidateIndex;
                var _this = this;
                var _a, _b, _c, _d;
                return __generator(this, function (_e) {
                    switch (_e.label) {
                        case 0:
                            stepStartTime = process.hrtime.bigint();
                            if (!products || products.length === 0) {
                                this.logger.warn('No hay productos para procesar con GPT', SearchService.name);
                                return [2 /*return*/, { codigo: null, descripcion: null, similitud: "DISTINTO" }];
                            }
                            _e.label = 1;
                        case 1:
                            _e.trys.push([1, 6, , 7]);
                            this.logger.log("Iniciando selectBestProductWithGPT para: \"".concat(originalQuery, "\" con segment preference: ").concat(segment || 'any'), SearchService.name, { productos_disponibles: products.length, segment_param_received: segment, segment_type: typeof segment });
                            productsForGPT = products.map(function (product, index) {
                                var cleanText = (product.descripcion || '').trim();
                                var productCode = (product.codigo || '').trim();
                                var productMarca = (product.marca || 'N/A').trim();
                                var productSegment = (product.segment || 'standard').trim();
                                var productCodFabrica = (product.codfabrica || '').trim();
                                return {
                                    index: index + 1,
                                    codigo: productCode,
                                    text: cleanText,
                                    marca: productMarca,
                                    segment: productSegment,
                                    codfabrica: productCodFabrica,
                                    vectorSimilarity: Number(product.similarity || 0).toFixed(4),
                                    adjustedSimilarity: undefined,
                                    segmentBoost: undefined
                                };
                            });
                            // --- SISTEMA DE BOOST POR SEGMENTO ---
                            // Aplica multiplicadores de similaridad según preferencia de segmento (premium, standard, economy)
                            if (segment) {
                                this.logger.log("APLICANDO BOOST PARA SEGMENTO: ".concat(segment), SearchService.name);
                                productsForGPT.forEach(function (product) {
                                    var segmentMultiplier = 1.0;
                                    if (product.segment === segment) {
                                        segmentMultiplier = 1.3; // Boost moderado del 30% para segmento preferido
                                    }
                                    else if ((segment === 'premium' && product.segment === 'standard') ||
                                        (segment === 'economy' && product.segment === 'standard') ||
                                        (segment === 'standard' && (product.segment === 'premium' || product.segment === 'economy'))) {
                                        segmentMultiplier = 1.2; // Boost del 20% para segmentos compatibles
                                    }
                                    var originalSimilarity = parseFloat(product.vectorSimilarity);
                                    var boostedSimilarity = Math.min(1.0, originalSimilarity * segmentMultiplier);
                                    product.adjustedSimilarity = boostedSimilarity.toFixed(4);
                                    product.segmentBoost = ((segmentMultiplier - 1.0) * 100).toFixed(1) + '%';
                                    _this.logger.log("BOOST APLICADO: ".concat(product.marca, " (").concat(product.segment, ") - Original: ").concat(originalSimilarity, " -> Boosted: ").concat(boostedSimilarity, " (x").concat(segmentMultiplier, ")"), SearchService.name);
                                });
                                // Reordenar productos por similaridad ajustada
                                productsForGPT.sort(function (a, b) {
                                    var aScore = parseFloat(a.adjustedSimilarity || a.vectorSimilarity);
                                    var bScore = parseFloat(b.adjustedSimilarity || b.vectorSimilarity);
                                    return bScore - aScore;
                                });
                            }
                            candidatos = {};
                            maxCandidatos = limit || 5;
                            for (i = 0; i < Math.min(products.length, maxCandidatos); i++) {
                                candidateIndex = i + 1;
                                candidatos["CA".concat(candidateIndex)] = products[i].codigo || '';
                                candidatos["DA".concat(candidateIndex)] = products[i].descripcion || '';
                            }
                            segmentInstructions = '';
                            if (segment) {
                                segmentInstructions = "\nIMPORTANTE - PREFERENCIA DE SEGMENTO:\nEl usuario solicit\u00F3 espec\u00EDficamente productos del segmento '".concat(segment, "'. \nOrden de preferencia:\n").concat(segment === 'premium' ? '1. premium (+30% boost) 2. standard (+20% boost) 3. economy (sin boost)' :
                                    segment === 'standard' ? '1. standard (+30% boost) 2. premium/economy (+20% boost)' :
                                        '1. economy (+30% boost) 2. standard (+20% boost) 3. premium (sin boost)', "\n\nIMPORTANTE: Considera las puntuaciones ADJUSTED_SIMILARITY - ya incluyen la preferencia de segmento.");
                            }
                            productList = productsForGPT.map(function (p) {
                                var similarityDisplay = segment && p.adjustedSimilarity
                                    ? "SIMILARITY: ".concat(p.vectorSimilarity, " | ADJUSTED_SIMILARITY: ").concat(p.adjustedSimilarity, " (boost: +").concat(p.segmentBoost || '0.000', ")")
                                    : "SIMILARITY: ".concat(p.vectorSimilarity);
                                return "".concat(p.index, ". CODE: ").concat(p.codigo, " | DESCRIPTION: \"").concat(p.text, "\" | BRAND: ").concat(p.marca, " | SEGMENT: ").concat(p.segment, " | FACTORY_CODE: ").concat(p.codfabrica, " | ").concat(similarityDisplay);
                            }).join('\n');
                            prompt_1 = "Analiza los productos y selecciona el mejor match para la b\u00FAsqueda del usuario.\n\nCONSULTA DEL USUARIO: \"".concat(originalQuery, "\"\n\nPRODUCTOS DISPONIBLES:\n").concat(productList, "\n\n").concat(segmentInstructions, "\n\nESCALA DE SIMILITUD:\n- EXACTO: Es exactamente lo que busca el usuario\n- EQUIVALENTE: Cumple la misma funci\u00F3n con especificaciones similares\n- COMPATIBLE: Funciona para el mismo prop\u00F3sito\n- ALTERNATIVO: Puede servir pero con diferencias\n- DISTINTO: No es lo que busca\n\nINSTRUCCIONES:\n1. Analiza cada producto considerando: marca, modelo, caracter\u00EDsticas, c\u00F3digo de f\u00E1brica\n2. Selecciona SOLO UN producto (el mejor match)\n3. Si se especific\u00F3 preferencia de segmento, PRIORIZA las puntuaciones ADJUSTED_SIMILARITY\n4. Las puntuaciones ajustadas ya incluyen la preferencia de segmento\n5. Responde \u00DANICAMENTE con JSON v\u00E1lido:\n\n{\n  \"selectedIndex\": 1,\n  \"similitud\": \"EXACTO\",\n  \"razon\": \"Explicaci\u00F3n breve en espa\u00F1ol\"\n}");
                            this.logger.debug("Enviando prompt a GPT", SearchService.name, {
                                prompt_length: prompt_1.length,
                                productos_procesados: productsForGPT.length,
                                segment_preference: segment
                            });
                            gptCallStart = process.hrtime.bigint();
                            gptResponse = void 0;
                            _e.label = 2;
                        case 2:
                            _e.trys.push([2, 4, , 5]);
                            return [4 /*yield*/, Promise.race([
                                    this.openai.chat.completions.create({
                                        model: "gpt-4o",
                                        messages: [
                                            {
                                                role: "system",
                                                content: "Eres un experto en análisis de productos industriales. SIEMPRE respondes con JSON válido y nada más. Tus explicaciones deben ser en español."
                                            },
                                            {
                                                role: "user",
                                                content: prompt_1
                                            }
                                        ],
                                        temperature: 0.1,
                                        max_tokens: 200,
                                        response_format: { type: "json_object" }
                                    }),
                                    new Promise(function (_, reject) {
                                        return setTimeout(function () { return reject(new Error('GPT selection timeout after 15s')); }, 15000);
                                    })
                                ])];
                        case 3:
                            gptResponse = (_e.sent());
                            return [3 /*break*/, 5];
                        case 4:
                            openaiError_1 = _e.sent();
                            this.logger.error("Error en llamada a OpenAI API", openaiError_1.stack, SearchService.name, {
                                error_type: openaiError_1.constructor.name,
                                error_code: openaiError_1.code,
                                error_status: openaiError_1.status
                            });
                            throw new Error("OpenAI API Error: ".concat(openaiError_1.message));
                        case 5:
                            gptCallEnd = process.hrtime.bigint();
                            this.logger.debug("Llamada a GPT completada exitosamente.", SearchService.name, {
                                duration_ms: Number(gptCallEnd - gptCallStart) / 1000000,
                                model: "gpt-4o",
                                tokens_used: ((_a = gptResponse.usage) === null || _a === void 0 ? void 0 : _a.total_tokens) || 0
                            });
                            gptContent = (_d = (_c = (_b = gptResponse.choices[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) === null || _d === void 0 ? void 0 : _d.trim();
                            this.logger.debug("Respuesta GPT recibida", SearchService.name, {
                                content_length: (gptContent === null || gptContent === void 0 ? void 0 : gptContent.length) || 0,
                                raw_content: (gptContent === null || gptContent === void 0 ? void 0 : gptContent.substring(0, 200)) + ((gptContent === null || gptContent === void 0 ? void 0 : gptContent.length) > 200 ? '...' : '')
                            });
                            if (!gptContent) {
                                throw new Error('GPT devolvió contenido vacío');
                            }
                            gptDecision = void 0;
                            try {
                                gptDecision = JSON.parse(gptContent);
                                if (!gptDecision.selectedIndex || !gptDecision.similitud) {
                                    throw new Error('JSON response missing required fields');
                                }
                                index = parseInt(gptDecision.selectedIndex);
                                if (isNaN(index) || index < 1 || index > productsForGPT.length) {
                                    throw new Error("Invalid selectedIndex: ".concat(gptDecision.selectedIndex));
                                }
                                validSimilitudes = ['EXACTO', 'EQUIVALENTE', 'COMPATIBLE', 'ALTERNATIVO', 'DISTINTO'];
                                if (!validSimilitudes.includes(gptDecision.similitud)) {
                                    this.logger.warn("Invalid similitud value: ".concat(gptDecision.similitud, ", using ALTERNATIVO"), SearchService.name);
                                    gptDecision.similitud = 'ALTERNATIVO';
                                }
                            }
                            catch (parseError) {
                                this.logger.error("Error parsing GPT JSON response", parseError.stack, SearchService.name, {
                                    raw_response: gptContent,
                                    parse_error: parseError.message
                                });
                                gptDecision = {
                                    selectedIndex: 1,
                                    similitud: "ALTERNATIVO",
                                    razon: "Error parsing GPT response, using highest similarity product. Parse error: ".concat(parseError.message)
                                };
                            }
                            selectedProduct = productsForGPT[gptDecision.selectedIndex - 1];
                            if (!selectedProduct) {
                                throw new Error("Selected product not found at index ".concat(gptDecision.selectedIndex));
                            }
                            totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1000000;
                            this.logger.log("selectBestProductWithGPT completado exitosamente.", SearchService.name, {
                                duration_ms: totalStepTime,
                                selected_similitud: gptDecision.similitud,
                                selected_index: gptDecision.selectedIndex,
                                selected_codigo: selectedProduct.codigo,
                                selected_brand: selectedProduct.marca,
                                selected_segment: selectedProduct.segment
                            });
                            return [2 /*return*/, __assign({ codigo: selectedProduct.codigo, descripcion: selectedProduct.text, similitud: gptDecision.similitud, razon: gptDecision.razon || 'Selected by GPT', marca: selectedProduct.marca, segment: selectedProduct.segment }, candidatos)];
                        case 6:
                            error_3 = _e.sent();
                            totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1000000;
                            this.logger.error("Error cr\u00EDtico en selectBestProductWithGPT", error_3.stack, SearchService.name, {
                                duration_ms: totalStepTime,
                                error_message: error_3.message,
                                error_type: error_3.constructor.name,
                                original_query: originalQuery,
                                products_count: products.length
                            });
                            // --- SISTEMA DE FALLBACK ROBUSTO ---
                            // En caso de error, selecciona el producto con mayor similaridad como respaldo
                            try {
                                firstProduct = products[0];
                                cleanText = (firstProduct.descripcion || '').trim();
                                productCode = (firstProduct.codigo || '').trim();
                                productMarca = (firstProduct.marca || 'N/A').trim();
                                productSegment = (firstProduct.segment || 'standard').trim();
                                candidatos = {};
                                maxCandidatos = limit || 5;
                                for (i = 0; i < Math.min(products.length, maxCandidatos); i++) {
                                    candidateIndex = i + 1;
                                    candidatos["CA".concat(candidateIndex)] = products[i].codigo || '';
                                    candidatos["DA".concat(candidateIndex)] = products[i].descripcion || '';
                                }
                                this.logger.log("Usando fallback: primer producto disponible", SearchService.name, {
                                    fallback_codigo: productCode,
                                    fallback_marca: productMarca,
                                    fallback_segment: productSegment
                                });
                                return [2 /*return*/, __assign({ codigo: productCode, descripcion: cleanText, similitud: "ALTERNATIVO", razon: "Fallback after GPT error: ".concat(error_3.message), marca: productMarca, segment: productSegment }, candidatos)];
                            }
                            catch (fallbackError) {
                                this.logger.error("Error cr\u00EDtico en fallback", fallbackError.stack, SearchService.name);
                                return [2 /*return*/, {
                                        codigo: null,
                                        descripcion: null,
                                        similitud: "DISTINTO",
                                        razon: "Critical error in product selection: ".concat(error_3.message),
                                        marca: null,
                                        segment: 'standard'
                                    }];
                            }
                            return [3 /*break*/, 7];
                        case 7: return [2 /*return*/];
                    }
                });
            });
        };
        // Normaliza queries de usuario usando GPT-4o para mejorar busquedas
        // Corrige errores ortograficos, expande abreviaciones y mejora la especificidad
        // del texto de busqueda para obtener mejores resultados vectoriales.
        SearchService_1.prototype.normalizeQueryWithGPT = function (query) {
            return __awaiter(this, void 0, void 0, function () {
                var stepStartTime, gptNormalizationCallStart, response, gptNormalizationCallEnd, normalized, totalStepTime, error_4, totalStepTime;
                var _a, _b;
                return __generator(this, function (_c) {
                    switch (_c.label) {
                        case 0:
                            stepStartTime = process.hrtime.bigint();
                            _c.label = 1;
                        case 1:
                            _c.trys.push([1, 3, , 4]);
                            this.logger.log("Iniciando normalizaci\u00F3n de query con GPT-4o para: \"".concat(query, "\""), SearchService.name);
                            gptNormalizationCallStart = process.hrtime.bigint();
                            return [4 /*yield*/, Promise.race([
                                    this.openai.chat.completions.create({
                                        model: "gpt-4o",
                                        messages: [
                                            {
                                                role: "system",
                                                content: "Tu tarea es encontrar el nombre t\u00E9cnico m\u00E1s preciso a partir del query del usuario. Debes devolver S\u00D3LO el nombre t\u00E9cnico, sin explicaciones ni texto adicional. Incluye marca, tipo, modelo, color, tama\u00F1o, o presentaci\u00F3n si son relevantes y est\u00E1n impl\u00EDcitos en el query. Corrige posibles errores ortogr\u00E1ficos, contracciones o modismos. Aseg\u00FArate de que la respuesta sea en min\u00FAsculas y sin comillas al inicio o al final.\n\n              Ejemplos:\n              \"pintura blanca 5 gal sherwin\" => pintura sherwin-williams blanca 5 galones\n              \"guantes de corte nivel 5 m\" => guantes anticorte nivel 5 talla m\n              \"silicona teka transparente 280ml\" => silicona neutra transparente teka 280ml\n              \"brocha tumi 2\" => brocha de nylon tumi 2 pulgadas\n              \"tubo pvc 1/2 agua fria\" => tubo pvc presi\u00F3n 1/2 pulgada agua fr\u00EDa\n              \"martillo stanley u\u00F1a\" => martillo de u\u00F1a stanley\n              \"llave francesa 10\" => llave ajustable 10 pulgadas"
                                            },
                                            {
                                                role: "user",
                                                content: "Normaliza este query: \"".concat(query, "\"")
                                            }
                                        ],
                                        temperature: 0.2,
                                        max_tokens: 100
                                    }),
                                    new Promise(function (_, reject) { return setTimeout(function () { return reject(new Error('GPT normalization timeout')); }, 25000); })
                                ])];
                        case 2:
                            response = _c.sent();
                            gptNormalizationCallEnd = process.hrtime.bigint();
                            this.logger.debug("Llamada a GPT para normalizaci\u00F3n completada.", SearchService.name, {
                                duration_ms: Number(gptNormalizationCallEnd - gptNormalizationCallStart) / 1000000,
                                model: "gpt-4o",
                                tokens_used: (_a = response.usage) === null || _a === void 0 ? void 0 : _a.total_tokens
                            });
                            normalized = (_b = response.choices[0].message.content) === null || _b === void 0 ? void 0 : _b.trim();
                            if (normalized && (normalized.startsWith('"') && normalized.endsWith('"'))) {
                                normalized = normalized.slice(1, -1);
                            }
                            normalized = (normalized === null || normalized === void 0 ? void 0 : normalized.toLowerCase()) || query.toLowerCase();
                            this.logger.log("Query normalizada: \"".concat(normalized, "\""), SearchService.name, { original_query: query, normalized_query: normalized });
                            totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1000000;
                            this.logger.log("normalizeQueryWithGPT finalizado.", SearchService.name, {
                                duration_ms: totalStepTime,
                                final_query: normalized
                            });
                            return [2 /*return*/, normalized];
                        case 3:
                            error_4 = _c.sent();
                            totalStepTime = Number(process.hrtime.bigint() - stepStartTime) / 1000000;
                            this.logger.error("Error en normalizaci\u00F3n con GPT.", error_4.stack, SearchService.name, { duration_ms: totalStepTime, error_message: error_4.message });
                            this.logger.warn("Fall\u00F3 la normalizaci\u00F3n GPT, usando query original: \"".concat(query, "\""), SearchService.name);
                            return [2 /*return*/, query];
                        case 4: return [2 /*return*/];
                    }
                });
            });
        };
        SearchService_1.prototype.onModuleDestroy = function () {
            return __awaiter(this, void 0, void 0, function () {
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            this.logger.log("Cerrando pool de conexiones de PostgreSQL en SearchService.", SearchService.name);
                            return [4 /*yield*/, this.pool.end()];
                        case 1:
                            _a.sent();
                            return [2 /*return*/];
                    }
                });
            });
        };
        return SearchService_1;
    }());
    __setFunctionName(_classThis, "SearchService");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        SearchService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return SearchService = _classThis;
}();
exports.SearchService = SearchService;
