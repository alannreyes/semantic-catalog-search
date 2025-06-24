"use strict";
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchService = void 0;
var common_1 = require("@nestjs/common");
var pg_1 = require("pg");
var axios_1 = require("axios");
var SearchService = function () {
    var _classDecorators = [(0, common_1.Injectable)()];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var SearchService = _classThis = /** @class */ (function () {
        function SearchService_1(configService) {
            this.configService = configService;
            // Usar directamente DATABASE_URL en lugar de variables individuales
            var databaseUrl = this.configService.get('DATABASE_URL');
            this.pool = new pg_1.Pool({
                connectionString: databaseUrl
            });
            // Obtener la clave API de OpenAI de las variables de entorno
            var apiKey = this.configService.get('OPENAI_API_KEY');
            if (!apiKey) {
                throw new Error('OPENAI_API_KEY is not defined');
            }
            this.openaiApiKey = apiKey;
        }
        // Extraer código interno de metadata o texto
        SearchService_1.prototype.extractCodigoInterno = function (product) {
            // Primero intentar extraer de metadata.codigo si existe
            if (product.metadata && product.metadata.codigo) {
                return product.metadata.codigo;
            }
            // Si no está en metadata, intentar extraerlo del texto
            if (product.text) {
                // Buscar patrones de código como TP998638 o 04010967
                var tpMatch = product.text.match(/(?:TP|tp|Tp)([0-9]+)/i);
                var numericMatch = product.text.match(/(?<!\w)0\d{6,7}(?!\w)/); // Coincide con números que empiezan con 0 y tienen 7-8 dígitos
                if (tpMatch && tpMatch[0]) {
                    return tpMatch[0];
                }
                else if (numericMatch && numericMatch[0]) {
                    return numericMatch[0];
                }
            }
            // Si no se encuentra en texto, verificar si hay un "id" en metadata que podría ser el código
            if (product.metadata && product.metadata.id) {
                return product.metadata.id;
            }
            return '[empty]'; // Valor por defecto si no se encuentra el código
        };
        SearchService_1.prototype.searchProducts = function (query_1) {
            return __awaiter(this, arguments, void 0, function (query, limit) {
                var searchQuery, result, formattedResults, error_1;
                var _this = this;
                if (limit === void 0) { limit = 5; }
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            _a.trys.push([0, 2, , 3]);
                            searchQuery = "\n        SELECT \n          id,\n          text,\n          metadata,\n          similarity(text, $1) AS similarity_score\n        FROM \n          productos\n        WHERE \n          text % $1\n        ORDER BY \n          similarity(text, $1) DESC\n        LIMIT $2;\n      ";
                            return [4 /*yield*/, this.pool.query(searchQuery, [query, limit])];
                        case 1:
                            result = _a.sent();
                            formattedResults = result.rows.map(function (product) {
                                var similarityPercentage = Math.round(product.similarity_score * 100);
                                // Extraer el código interno
                                var codigoInterno = _this.extractCodigoInterno(product);
                                return {
                                    id: product.id,
                                    articulo_buscado: query,
                                    articulo_encontrado: product.text,
                                    codigo_interno: codigoInterno,
                                    distancia_coseno: "".concat(similarityPercentage, "%"),
                                    metadata: product.metadata
                                };
                            });
                            return [2 /*return*/, formattedResults];
                        case 2:
                            error_1 = _a.sent();
                            console.error('Error en searchProducts:', error_1.message);
                            throw new Error("Error performing semantic search: ".concat(error_1.message));
                        case 3: return [2 /*return*/];
                    }
                });
            });
        };
        // Método que usa pgvector para búsqueda vectorial con distancia de coseno
        SearchService_1.prototype.searchProductsWithVector = function (query_1) {
            return __awaiter(this, arguments, void 0, function (query, limit) {
                var searchQuery, result, formattedResults, error_2;
                var _this = this;
                if (limit === void 0) { limit = 5; }
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            _a.trys.push([0, 2, , 3]);
                            searchQuery = "\n        WITH query_embedding AS (\n          SELECT openai_embedding($1) AS embedding\n        )\n        SELECT \n          id,\n          text,\n          metadata,\n          1 - (embedding <=> q.embedding) AS cosine_similarity,\n          embedding <=> q.embedding AS cosine_distance\n        FROM \n          productos p, \n          query_embedding q\n        ORDER BY \n          cosine_distance ASC\n        LIMIT $2;\n      ";
                            return [4 /*yield*/, this.pool.query(searchQuery, [query, limit])];
                        case 1:
                            result = _a.sent();
                            formattedResults = result.rows.map(function (product) {
                                // Convertir la distancia coseno a un porcentaje de similitud (0-100%)
                                var similarityPercentage = Math.round(product.cosine_similarity * 100);
                                // Extraer el código interno
                                var codigoInterno = _this.extractCodigoInterno(product);
                                return {
                                    id: product.id,
                                    articulo_buscado: query,
                                    articulo_encontrado: product.text,
                                    codigo_interno: codigoInterno,
                                    distancia_coseno: "".concat(similarityPercentage, "%"),
                                    metadata: product.metadata
                                };
                            });
                            return [2 /*return*/, formattedResults];
                        case 2:
                            error_2 = _a.sent();
                            console.error('Error en searchProductsWithVector:', error_2.message);
                            throw new Error("Error performing vector search: ".concat(error_2.message));
                        case 3: return [2 /*return*/];
                    }
                });
            });
        };
        // Método para procesar los resultados con GPT-4.1 mini
        SearchService_1.prototype.processResultsWithGPT = function (results, query) {
            return __awaiter(this, void 0, void 0, function () {
                var resultadosTexto_1, openaiResponse, gptResponse, error_3, primeraLinea, lineasResultado_1, resultadosOrdenados;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            _a.trys.push([0, 2, , 3]);
                            resultadosTexto_1 = "Resultados de b\u00FAsqueda para: \"".concat(query, "\"\n\n");
                            results.forEach(function (item, index) {
                                // Asegurarse de que articulo_encontrado es un string
                                var nombreProducto = "";
                                if (typeof item.articulo_encontrado === "string") {
                                    nombreProducto = item.articulo_encontrado;
                                }
                                else if (item.text) {
                                    nombreProducto = item.text;
                                }
                                resultadosTexto_1 += "".concat(index + 1, ") ").concat(nombreProducto, " (").concat(item.codigo_interno, ") [").concat(item.distancia_coseno, "]\n");
                            });
                            return [4 /*yield*/, axios_1.default.post('https://api.openai.com/v1/chat/completions', {
                                    model: 'gpt-3.5-turbo', // Modelo más común y disponible
                                    messages: [
                                        {
                                            role: 'system',
                                            content: 'Analiza estos resultados de búsqueda y reorganízalos en 5 líneas por orden de similitud real. Ignora cualquier formato JSON y extrae solo los nombres de productos, códigos y porcentajes. Si el primer producto es muy similar al buscado (>50%), añade "- COINCIDENCIA EXACTA" al final de esa línea. Responde SOLO con 5 líneas en este formato exacto: "1) NOMBRE DEL PRODUCTO (CÓDIGO) [PORCENTAJE] - COINCIDENCIA EXACTA si aplica"'
                                        },
                                        {
                                            role: 'user',
                                            content: resultadosTexto_1
                                        }
                                    ],
                                    temperature: 0.3,
                                    max_tokens: 500
                                }, {
                                    headers: {
                                        'Authorization': "Bearer ".concat(this.openaiApiKey),
                                        'Content-Type': 'application/json'
                                    }
                                })];
                        case 1:
                            openaiResponse = _a.sent();
                            gptResponse = openaiResponse.data.choices[0].message.content;
                            // Formatear la respuesta final con 6 líneas (1 de consulta + 5 de resultados)
                            return [2 /*return*/, "".concat(query, "\n").concat(gptResponse)];
                        case 2:
                            error_3 = _a.sent();
                            console.error('Error al procesar con GPT:', error_3.message);
                            primeraLinea = query;
                            lineasResultado_1 = "";
                            resultadosOrdenados = __spreadArray([], results, true).sort(function (a, b) {
                                var porcA = parseInt((a.distancia_coseno || "0%").replace("%", ""));
                                var porcB = parseInt((b.distancia_coseno || "0%").replace("%", ""));
                                return porcB - porcA;
                            });
                            // Generar 5 líneas formateadas
                            resultadosOrdenados.slice(0, 5).forEach(function (item, index) {
                                // Extraer nombre limpio del producto
                                var nombreProducto = "";
                                if (typeof item.articulo_encontrado === "string") {
                                    nombreProducto = item.articulo_encontrado;
                                }
                                else if (item.text) {
                                    nombreProducto = item.text;
                                }
                                // Extraer código y porcentaje
                                var codigo = item.codigo_interno || "[sin código]";
                                var similitud = item.distancia_coseno || "0%";
                                var porcentaje = parseInt(similitud.replace("%", "")) || 0;
                                // Formar línea
                                var linea = "".concat(index + 1, ") ").concat(nombreProducto, " (").concat(codigo, ") [").concat(similitud, "]");
                                // Añadir indicador de coincidencia exacta al primer resultado si tiene alta similitud
                                if (index === 0 && porcentaje >= 50) {
                                    linea += " - COINCIDENCIA EXACTA";
                                }
                                lineasResultado_1 += linea + "\n";
                            });
                            // Devolver 6 líneas: la consulta + 5 resultados
                            return [2 /*return*/, "".concat(primeraLinea, "\n").concat(lineasResultado_1.trim())];
                        case 3: return [2 /*return*/];
                    }
                });
            });
        };
        // Método para buscar y procesar con GPT en un solo paso
        SearchService_1.prototype.searchAndProcess = function (query_1) {
            return __awaiter(this, arguments, void 0, function (query, limit) {
                var searchResults, processedResults, error_4, searchResults, processedResults, secondError_1;
                if (limit === void 0) { limit = 5; }
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            _a.trys.push([0, 3, , 9]);
                            return [4 /*yield*/, this.searchProductsWithVector(query, limit)];
                        case 1:
                            searchResults = _a.sent();
                            return [4 /*yield*/, this.processResultsWithGPT(searchResults, query)];
                        case 2:
                            processedResults = _a.sent();
                            return [2 /*return*/, processedResults]; // Devuelve directamente las 6 líneas de texto
                        case 3:
                            error_4 = _a.sent();
                            console.log('Vector search failed, trying trigram search:', error_4.message);
                            _a.label = 4;
                        case 4:
                            _a.trys.push([4, 7, , 8]);
                            return [4 /*yield*/, this.searchProducts(query, limit)];
                        case 5:
                            searchResults = _a.sent();
                            return [4 /*yield*/, this.processResultsWithGPT(searchResults, query)];
                        case 6:
                            processedResults = _a.sent();
                            return [2 /*return*/, processedResults]; // Devuelve directamente las 6 líneas de texto
                        case 7:
                            secondError_1 = _a.sent();
                            console.error('All search methods failed:', secondError_1.message);
                            // Incluso en caso de error, devolver un formato consistente
                            return [2 /*return*/, "".concat(query, "\nNo se encontraron resultados: ").concat(secondError_1.message)];
                        case 8: return [3 /*break*/, 9];
                        case 9: return [2 /*return*/];
                    }
                });
            });
        };
        // El método safeSearch ahora es un alias de searchAndProcess para compatibilidad
        SearchService_1.prototype.safeSearch = function (query_1) {
            return __awaiter(this, arguments, void 0, function (query, limit) {
                if (limit === void 0) { limit = 5; }
                return __generator(this, function (_a) {
                    return [2 /*return*/, this.searchAndProcess(query, limit)];
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
