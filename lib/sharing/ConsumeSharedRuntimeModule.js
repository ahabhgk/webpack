/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const RuntimeGlobals = require("../RuntimeGlobals");
const RuntimeModule = require("../RuntimeModule");
const Template = require("../Template");
const {
	parseVersionRuntimeCode,
	versionLtRuntimeCode,
	rangeToStringRuntimeCode,
	satisfyRuntimeCode,
	stringifyHoley
} = require("../util/semver");

/** @typedef {import("webpack-sources").Source} Source */
/** @typedef {import("../Chunk")} Chunk */
/** @typedef {import("../ChunkGraph")} ChunkGraph */
/** @typedef {import("../Compilation")} Compilation */
/** @typedef {import("../Module")} Module */
/** @typedef {import("./ConsumeSharedModule")} ConsumeSharedModule */

/** @typedef {{ shareScope: string, shareKey: string, strictVersion: boolean, requiredVersion: false | import("../util/semver").SemVerRange, import: string | undefined, singleton: boolean, eager: boolean, fallback: string | undefined }} ConsumeData */

class ConsumeSharedRuntimeModule extends RuntimeModule {
	/**
	 * @param {ReadonlySet<string>} runtimeRequirements runtime requirements
	 */
	constructor(runtimeRequirements) {
		super("consumes", RuntimeModule.STAGE_ATTACH);
		this._runtimeRequirements = runtimeRequirements;
	}

	/**
	 * @returns {string | null} runtime code
	 */
	generate() {
		const compilation = /** @type {Compilation} */ (this.compilation);
		const chunkGraph = /** @type {ChunkGraph} */ (this.chunkGraph);
		const { runtimeTemplate, codeGenerationResults } = compilation;
		const chunkToModuleMapping = {};
		/** @type {Map<string | number, ConsumeData>} */
		const moduleIdToConsumeDataMapping = new Map();
		/** @type {(string | number)[]} */
		const initialConsumes = [];
		/**
		 *
		 * @param {Iterable<Module>} modules modules
		 * @param {Chunk} chunk the chunk
		 * @param {(string | number)[]} list list of ids
		 */
		const addModules = (modules, chunk, list) => {
			for (const m of modules) {
				const module = /** @type {ConsumeSharedModule} */ (m);
				const id = chunkGraph.getModuleId(module);
				list.push(id);
				moduleIdToConsumeDataMapping.set(
					id,
					codeGenerationResults.getData(module, chunk.runtime, "consume-shared")
				);
			}
		};
		for (const chunk of /** @type {Chunk} */ (this.chunk).getAllAsyncChunks()) {
			const modules = chunkGraph.getChunkModulesIterableBySourceType(
				chunk,
				"consume-shared"
			);
			if (!modules) continue;
			addModules(modules, chunk, (chunkToModuleMapping[chunk.id] = []));
		}
		for (const chunk of /** @type {Chunk} */ (
			this.chunk
		).getAllInitialChunks()) {
			const modules = chunkGraph.getChunkModulesIterableBySourceType(
				chunk,
				"consume-shared"
			);
			if (!modules) continue;
			addModules(modules, chunk, initialConsumes);
		}
		if (moduleIdToConsumeDataMapping.size === 0) return null;
		const moduleIdToConsumeDataMappingStr = Template.asString([
			`{`,
			Template.indent(
				Array.from(moduleIdToConsumeDataMapping, ([key, data]) => {
					const requiredVersion = stringifyHoley(data.requiredVersion);
					return `${JSON.stringify(key)}: { shareScope: ${JSON.stringify(
						data.shareScope
					)}, shareKey: ${JSON.stringify(
						data.shareKey
					)}, import: ${JSON.stringify(
						data.import
					)}, strictVersion: ${JSON.stringify(
						data.strictVersion
					)}, singleton: ${JSON.stringify(
						data.singleton
					)}, eager: ${JSON.stringify(data.eager)}, fallback: ${data.fallback}${
						requiredVersion ? `, requiredVersion: ${requiredVersion}` : ""
					} },`;
				})
			),
			`}`
		]);
		return Template.asString([
			parseVersionRuntimeCode(runtimeTemplate),
			versionLtRuntimeCode(runtimeTemplate),
			rangeToStringRuntimeCode(runtimeTemplate),
			satisfyRuntimeCode(runtimeTemplate),
			`var ensureExistence = ${runtimeTemplate.basicFunction("scopeName, key", [
				`var scope = ${RuntimeGlobals.shareScopeMap}[scopeName];`,
				`if(!scope || !${RuntimeGlobals.hasOwnProperty}(scope, key)) throw new Error("Shared module " + key + " doesn't exist in shared scope " + scopeName);`,
				"return scope;"
			])};`,
			`var findVersion = ${runtimeTemplate.basicFunction("scope, key", [
				"var versions = scope[key];",
				`var key = Object.keys(versions).reduce(${runtimeTemplate.basicFunction(
					"a, b",
					["return !a || versionLt(a, b) ? b : a;"]
				)}, 0);`,
				"return key && versions[key]"
			])};`,
			`var findSingletonVersionKey = ${runtimeTemplate.basicFunction(
				"scope, key",
				[
					"var versions = scope[key];",
					`return Object.keys(versions).reduce(${runtimeTemplate.basicFunction(
						"a, b",
						["return !a || (!versions[a].loaded && versionLt(a, b)) ? b : a;"]
					)}, 0);`
				]
			)};`,
			`var getInvalidSingletonVersionMessage = ${runtimeTemplate.basicFunction(
				"scope, key, version, requiredVersion",
				[
					`return "Unsatisfied version " + version + " from " + (version && scope[key][version].from) + " of shared singleton module " + key + " (required " + rangeToString(requiredVersion) + ")"`
				]
			)};`,
			`var getSingleton = ${runtimeTemplate.basicFunction(
				"scope, scopeName, key, requiredVersion",
				[
					"var version = findSingletonVersionKey(scope, key);",
					"return get(scope[key][version]);"
				]
			)};`,
			`var getSingletonVersion = ${runtimeTemplate.basicFunction(
				"scope, scopeName, key, requiredVersion",
				[
					"var version = findSingletonVersionKey(scope, key);",
					"if (!satisfy(requiredVersion, version)) warn(getInvalidSingletonVersionMessage(scope, key, version, requiredVersion));",
					"return get(scope[key][version]);"
				]
			)};`,
			`var getStrictSingletonVersion = ${runtimeTemplate.basicFunction(
				"scope, scopeName, key, requiredVersion",
				[
					"var version = findSingletonVersionKey(scope, key);",
					"if (!satisfy(requiredVersion, version)) " +
						"throw new Error(getInvalidSingletonVersionMessage(scope, key, version, requiredVersion));",
					"return get(scope[key][version]);"
				]
			)};`,
			`var findValidVersion = ${runtimeTemplate.basicFunction(
				"scope, key, requiredVersion",
				[
					"var versions = scope[key];",
					`var key = Object.keys(versions).reduce(${runtimeTemplate.basicFunction(
						"a, b",
						[
							"if (!satisfy(requiredVersion, b)) return a;",
							"return !a || versionLt(a, b) ? b : a;"
						]
					)}, 0);`,
					"return key && versions[key]"
				]
			)};`,
			`var getInvalidVersionMessage = ${runtimeTemplate.basicFunction(
				"scope, scopeName, key, requiredVersion",
				[
					"var versions = scope[key];",
					'return "No satisfying version (" + rangeToString(requiredVersion) + ") of shared module " + key + " found in shared scope " + scopeName + ".\\n" +',
					`\t"Available versions: " + Object.keys(versions).map(${runtimeTemplate.basicFunction(
						"key",
						['return key + " from " + versions[key].from;']
					)}).join(", ");`
				]
			)};`,
			`var getValidVersion = ${runtimeTemplate.basicFunction(
				"scope, scopeName, key, requiredVersion",
				[
					"var entry = findValidVersion(scope, key, requiredVersion);",
					"if(entry) return get(entry);",
					"throw new Error(getInvalidVersionMessage(scope, scopeName, key, requiredVersion));"
				]
			)};`,
			`var warn = ${
				compilation.outputOptions.ignoreBrowserWarnings
					? runtimeTemplate.basicFunction("", "")
					: runtimeTemplate.basicFunction("msg", [
							'if (typeof console !== "undefined" && console.warn) console.warn(msg);'
					  ])
			};`,
			`var warnInvalidVersion = ${runtimeTemplate.basicFunction(
				"scope, scopeName, key, requiredVersion",
				[
					"warn(getInvalidVersionMessage(scope, scopeName, key, requiredVersion));"
				]
			)};`,
			`var get = ${runtimeTemplate.basicFunction("entry", [
				"entry.loaded = 1;",
				"return entry.get()"
			])};`,
			`var init = ${runtimeTemplate.returningFunction(
				Template.asString([
					"function(scopeName, a, b, c) {",
					Template.indent([
						`var promise = ${RuntimeGlobals.initializeSharing}(scopeName);`,
						`if (promise && promise.then) return promise.then(fn.bind(fn, scopeName, ${RuntimeGlobals.shareScopeMap}[scopeName], a, b, c));`,
						`return fn(scopeName, ${RuntimeGlobals.shareScopeMap}[scopeName], a, b, c);`
					]),
					"}"
				]),
				"fn"
			)};`,
			"",
			`var load = /*#__PURE__*/ init(${runtimeTemplate.basicFunction(
				"scopeName, scope, key",
				[
					"ensureExistence(scopeName, key);",
					"return get(findVersion(scope, key));"
				]
			)});`,
			`var loadFallback = /*#__PURE__*/ init(${runtimeTemplate.basicFunction(
				"scopeName, scope, key, fallback",
				[
					`return scope && ${RuntimeGlobals.hasOwnProperty}(scope, key) ? get(findVersion(scope, key)) : fallback();`
				]
			)});`,
			`var loadVersionCheck = /*#__PURE__*/ init(${runtimeTemplate.basicFunction(
				"scopeName, scope, key, version",
				[
					"ensureExistence(scopeName, key);",
					"return get(findValidVersion(scope, key, version) || warnInvalidVersion(scope, scopeName, key, version) || findVersion(scope, key));"
				]
			)});`,
			`var loadSingleton = /*#__PURE__*/ init(${runtimeTemplate.basicFunction(
				"scopeName, scope, key",
				[
					"ensureExistence(scopeName, key);",
					"return getSingleton(scope, scopeName, key);"
				]
			)});`,
			`var loadSingletonVersionCheck = /*#__PURE__*/ init(${runtimeTemplate.basicFunction(
				"scopeName, scope, key, version",
				[
					"ensureExistence(scopeName, key);",
					"return getSingletonVersion(scope, scopeName, key, version);"
				]
			)});`,
			`var loadStrictVersionCheck = /*#__PURE__*/ init(${runtimeTemplate.basicFunction(
				"scopeName, scope, key, version",
				[
					"ensureExistence(scopeName, key);",
					"return getValidVersion(scope, scopeName, key, version);"
				]
			)});`,
			`var loadStrictSingletonVersionCheck = /*#__PURE__*/ init(${runtimeTemplate.basicFunction(
				"scopeName, scope, key, version",
				[
					"ensureExistence(scopeName, key);",
					"return getStrictSingletonVersion(scope, scopeName, key, version);"
				]
			)});`,
			`var loadVersionCheckFallback = /*#__PURE__*/ init(${runtimeTemplate.basicFunction(
				"scopeName, scope, key, version, fallback",
				[
					`if(!scope || !${RuntimeGlobals.hasOwnProperty}(scope, key)) return fallback();`,
					"return get(findValidVersion(scope, key, version) || warnInvalidVersion(scope, scopeName, key, version) || findVersion(scope, key));"
				]
			)});`,
			`var loadSingletonFallback = /*#__PURE__*/ init(${runtimeTemplate.basicFunction(
				"scopeName, scope, key, fallback",
				[
					`if(!scope || !${RuntimeGlobals.hasOwnProperty}(scope, key)) return fallback();`,
					"return getSingleton(scope, scopeName, key);"
				]
			)});`,
			`var loadSingletonVersionCheckFallback = /*#__PURE__*/ init(${runtimeTemplate.basicFunction(
				"scopeName, scope, key, version, fallback",
				[
					`if(!scope || !${RuntimeGlobals.hasOwnProperty}(scope, key)) return fallback();`,
					"return getSingletonVersion(scope, scopeName, key, version);"
				]
			)});`,
			`var loadStrictVersionCheckFallback = /*#__PURE__*/ init(${runtimeTemplate.basicFunction(
				"scopeName, scope, key, version, fallback",
				[
					`var entry = scope && ${RuntimeGlobals.hasOwnProperty}(scope, key) && findValidVersion(scope, key, version);`,
					`return entry ? get(entry) : fallback();`
				]
			)});`,
			`var loadStrictSingletonVersionCheckFallback = /*#__PURE__*/ init(${runtimeTemplate.basicFunction(
				"scopeName, scope, key, version, fallback",
				[
					`if(!scope || !${RuntimeGlobals.hasOwnProperty}(scope, key)) return fallback();`,
					"return getStrictSingletonVersion(scope, scopeName, key, version);"
				]
			)});`,
			`var resolveHandler = ${runtimeTemplate.basicFunction("data", [
				`var strict = false`,
				`var singleton = false`,
				`var versionCheck = false`,
				`var fallback = false`,
				`var args = [data.shareScope, data.shareKey];`,
				`if (data.requiredVersion) {`,
				Template.indent([
					`if (data.strictVersion) strict = true;`,
					`if (data.singleton) singleton = true;`,
					`args.push(data.requiredVersion);`,
					`versionCheck = true`
				]),
				`} else if (data.singleton) singleton = true;`,
				`if (data.fallback) {`,
				Template.indent([`fallback = true;`, `args.push(data.fallback);`]),
				`}`,
				`if (strict && singleton && versionCheck && fallback) return ${runtimeTemplate.returningFunction(
					"loadStrictSingletonVersionCheckFallback.apply(null, args)"
				)}`,
				`if (strict && versionCheck && fallback) return ${runtimeTemplate.returningFunction(
					"loadStrictVersionCheckFallback.apply(null, args)"
				)}`,
				`if (singleton && versionCheck && fallback) return ${runtimeTemplate.returningFunction(
					"loadSingletonVersionCheckFallback.apply(null, args)"
				)}`,
				`if (strict && singleton && versionCheck) return ${runtimeTemplate.returningFunction(
					"loadStrictSingletonVersionCheck.apply(null, args)"
				)}`,
				`if (singleton && fallback) return ${runtimeTemplate.returningFunction(
					"loadSingletonFallback.apply(null, args)"
				)}`,
				`if (versionCheck && fallback) return ${runtimeTemplate.returningFunction(
					"loadVersionCheckFallback.apply(null, args)"
				)}`,
				`if (strict && versionCheck) return ${runtimeTemplate.returningFunction(
					"loadStrictVersionCheck.apply(null, args)"
				)}`,
				`if (singleton && versionCheck) return ${runtimeTemplate.returningFunction(
					"loadSingletonVersionCheck.apply(null, args)"
				)}`,
				`if (singleton) return ${runtimeTemplate.returningFunction(
					"loadSingleton.apply(null, args)"
				)}`,
				`if (versionCheck) return ${runtimeTemplate.returningFunction(
					"loadVersionCheck.apply(null, args)"
				)}`,
				`if (fallback) return ${runtimeTemplate.returningFunction(
					"loadFallback.apply(null, args)"
				)}`,
				`return ${runtimeTemplate.returningFunction("load.apply(null, args)")}`
			])};`,
			"var installedModules = {};",
			`${RuntimeGlobals.require}.consumesLoadingData = {};`,
			`${RuntimeGlobals.require}.consumesLoadingData.moduleIdToConsumeDataMapping = ${moduleIdToConsumeDataMappingStr};`,

			initialConsumes.length > 0
				? Template.asString([
						`${
							RuntimeGlobals.require
						}.consumesLoadingData.initialConsumes = ${JSON.stringify(
							initialConsumes
						)};`,
						`${
							RuntimeGlobals.require
						}.consumesLoadingData.initialConsumes.forEach(${runtimeTemplate.basicFunction(
							"id",
							[
								`${
									RuntimeGlobals.moduleFactories
								}[id] = ${runtimeTemplate.basicFunction("module", [
									"// Handle case when module is used sync",
									"installedModules[id] = 0;",
									`delete ${RuntimeGlobals.moduleCache}[id];`,
									`var factory = resolveHandler(${RuntimeGlobals.require}.consumesLoadingData.moduleIdToConsumeDataMapping[id])();`,
									'if(typeof factory !== "function") throw new Error("Shared module is not available for eager consumption: " + id);',
									`module.exports = factory();`
								])}`
							]
						)});`
				  ])
				: "// no consumes in initial chunks",
			this._runtimeRequirements.has(RuntimeGlobals.ensureChunkHandlers)
				? Template.asString([
						`${
							RuntimeGlobals.require
						}.consumesLoadingData.chunkMapping = ${JSON.stringify(
							chunkToModuleMapping,
							null,
							"\t"
						)};`,
						`${
							RuntimeGlobals.ensureChunkHandlers
						}.consumes = ${runtimeTemplate.basicFunction("chunkId, promises", [
							`var moduleIdToConsumeDataMapping = ${RuntimeGlobals.require}.consumesLoadingData.moduleIdToConsumeDataMapping`,
							`var chunkMapping = ${RuntimeGlobals.require}.consumesLoadingData.chunkMapping;`,
							`if(${RuntimeGlobals.hasOwnProperty}(chunkMapping, chunkId)) {`,
							Template.indent([
								`chunkMapping[chunkId].forEach(${runtimeTemplate.basicFunction(
									"id",
									[
										`if(${RuntimeGlobals.hasOwnProperty}(installedModules, id)) return promises.push(installedModules[id]);`,
										`var onFactory = ${runtimeTemplate.basicFunction(
											"factory",
											[
												"installedModules[id] = 0;",
												`${
													RuntimeGlobals.moduleFactories
												}[id] = ${runtimeTemplate.basicFunction("module", [
													`delete ${RuntimeGlobals.moduleCache}[id];`,
													"module.exports = factory();"
												])}`
											]
										)};`,
										`var onError = ${runtimeTemplate.basicFunction("error", [
											"delete installedModules[id];",
											`${
												RuntimeGlobals.moduleFactories
											}[id] = ${runtimeTemplate.basicFunction("module", [
												`delete ${RuntimeGlobals.moduleCache}[id];`,
												"throw error;"
											])}`
										])};`,
										"try {",
										Template.indent([
											"var promise = resolveHandler(moduleIdToConsumeDataMapping[id])();",
											"if(promise.then) {",
											Template.indent(
												"promises.push(installedModules[id] = promise.then(onFactory)['catch'](onError));"
											),
											"} else onFactory(promise);"
										]),
										"} catch(e) { onError(e); }"
									]
								)});`
							]),
							"}"
						])}`
				  ])
				: "// no chunk loading of consumes"
		]);
	}
}

module.exports = ConsumeSharedRuntimeModule;
