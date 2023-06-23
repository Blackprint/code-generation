Blackprint.Code.registerHandler({
	languageName: 'JavaScript',
	languageId: 'js',

	routeFunction: `async function {{+bp current_route_name }}(){\n\t{{+bp wrap_code_here }}\n}`,
	routeFunctionName: `bp_route_{{+bp index }}`,
	routeFillEmpty: `/* Empty route */`,

	internalNodes: {
		// namespace: BP/Env/Get
		environmentGet(routes){
			let name = this.iface.data.name;
			let exportName = this.sharedData.mainShared?.exportName || 'exports';

			return {
				type: Blackprint.CodeType.NotWrapped,
				name: name,
				code: ``,
				outputAlias: {
					Val: `${exportName}.Environment.${name}`
				},
			};
		},

		// namespace: BP/Env/Set
		environmentSet(routes){
			let name = this.iface.data.name;
			let exportName = this.sharedData.mainShared?.exportName || 'exports';

			return {
				type: Blackprint.CodeType.NotWrapped,
				name: name,
				code: `${exportName}.Environment.${name} = Input.Val;`,
			};
		},

		// namespace: BP/Var/Get
		variableGet(routes){
			let data = this.iface.data;
			let name = data.name;

			let init = '';
			let codeType = Blackprint.CodeType.NotWrapped;
			if(this.iface.output.Val.type === Blackprint.Types.Trigger){
				let targets = this.iface.output.Val.cables.map(v => {
					let input = v.input;
					if(!input) return false;

					return `bp_input_${input.iface.i}.${input.name}(bp_input_${input.iface.i}, bp_output_${input.iface.i})`;
				}).filter(v => !!v);
				
				init = `bp_var${data.scope}["${name}"].push(() => { ${targets.join('; ')} });`;
				codeType = Blackprint.CodeType.Init;
			}

			return {
				type: codeType,
				name: name, code: '', init,
				outputAlias: {
					Val: `bp_var${data.scope}["${name}"]`
				},
			};
		},

		// namespace: BP/Var/Set
		variableSet(routes){
			let data = this.iface.data;
			let name = data.name;

			let code = '';
			let inputAlias = {};
			if(this.iface.input.Val.type === Blackprint.Types.Trigger){
				inputAlias.Val = `bp_callVars(bp_var${data.scope}["${name}"]);`;
			}
			else code = `bp_var${data.scope}["${name}"] = Input.Val;`;

			return {
				type: Blackprint.CodeType.NotWrapped,
				name: name, code, inputAlias,

				// If the input is Trigger type
				input: {
					Val: `bp_callVars(bp_var${data.scope}["${name}"]);`,
				}
			};
		},

		// namespace: BPI/F/*
		function(routes){
			let name = this.iface.namespace.replace('BPI/F/', '');
			let ifaceIndex = this.iface.node.instance.ifaceList.indexOf(this.iface);

			return {
				type: Blackprint.CodeType.NotWrapped,
				name: name,
				code: `await bp_func_${ifaceIndex}.call(bp_input_${ifaceIndex}, bp_output_${ifaceIndex});`,
			};
		},

		functionOutput(routes){
			let {namespace, input, node} = this.iface;

			function getInput(out){
				let ifaceList = node.instance.ifaceList;
				let targetIndex = ifaceList.indexOf(out.iface);
				let propAccessName = jsProp(out.name);

				return `${targetIndex}${propAccessName}`;
			}

			return {
				type: Blackprint.CodeType.NotWrapped,
				name: namespace,
				code: `/* Unexpected FnOutput code, this need to be fixed */`,
				onTemplateCached({ sharedData }){
					let list = [];
					for (let key in input) {
						let port = input[key];
						let cables = port.cables;
						if(cables.length === 0 || port.type === Blackprint.Types.Trigger)
							continue;

						let key_ = jsProp(key);

						if(port.feature === Blackprint.Port.ArrayOf){
							let temp = [];
							for (let i=0; i < cables.length; i++) {
								let out = cables[i].output;
								let templ = sharedData.template.get(out.iface);

								if(templ.outputAlias?.[out.name] != null)
									temp.push(templ.outputAlias[out.name]);
								else temp.push(`bp_output_${getInput(out)}`);
							}

							list.push(`BpFnOutput${key_} = [${temp.join(',')}]`);
						}
						else {
							let out = cables[0].output;
							let templ = sharedData.template.get(out.iface);

							let append = '';
							if(templ.outputAlias?.[out.name] != null)
								append = templ.outputAlias[out.name];
							else append = `bp_output_${getInput(out)}`;

							list.push(`BpFnOutput${key_} = ${append}`);
						}

						this.code = `// <-- FnOutput\n${list.join('; ')};`;
					}
				}
			};
		},
		functionInput(routes){
			let name = this.iface.namespace;

			return {
				type: Blackprint.CodeType.NotWrapped,
				selfRun: true,
				name: name,
				code: `// <-- FnInput`,
			};
		},
		functionVarOutput(routes){
			let name = this.iface.namespace;
			let data = this.iface.data;

			let code = '';
			if(this.iface.input.Val.type === Blackprint.Types.Trigger){
				code = `/* ToDo FnVarOut */`;
			}
			else code = `BpFnOutput["${data.name}"] = Input.Val;`

			return {
				type: Blackprint.CodeType.NotWrapped,
				name: name, code,

				// If the input is Trigger type
				input: {
					Val: `BpFnOutput["${data.name}"]?.();`,
				}
			};
		},
		functionVarInput(routes){
			let name = this.iface.namespace;
			let data = this.iface.data;
			let instance = this.node.instance;
			let proxyIface = instance.getNodes('BP/Fn/Input')[0].iface;
			let proxyIndex = instance.ifaceList.indexOf(proxyIface);

			let code = '';
			if(this.iface.output.Val.type === Blackprint.Types.Trigger){
				code = `/* ToDo FnVarIn */`;
			}

			return {
				type: Blackprint.CodeType.NotWrapped,
				name: name, code,
				outputAlias: {
					Val: `bp_output_${proxyIndex}["${data.name}"]`
				},
			};
		},

		// namespace: BP/Event/Listen
		eventListen(routes){
			let namespace = this.iface.data.namespace;
			let exportName = this.sharedData.mainShared?.exportName || 'exports';

			return {
				type: Blackprint.CodeType.Wrapper,
				selfRun: true,
				name: namespace,
				begin: `${exportName}.on("${namespace}", async function(Input){`,
				end: `});`,
				input: {
					Reset: '/* 1 */',
					Off: '/* 1 */',
				}
			};
		},

		// namespace: BP/Event/Emit
		eventEmit(routes){
			let namespace = this.iface.data.namespace;
			let ports = Object.keys(this.iface.input).map(v=> {
				let key;
				let quoted = JSON.stringify(v);

				if(/[^a-zA-Z]/.test(v)) key = `[${quoted}]`;
				else key = `.${v}`;

				return `${quoted}: Input${key}`;
			}).join(', ');

			let exportName = this.sharedData.mainShared?.exportName || 'exports';
			return {
				// type: Blackprint.CodeType.Wrapper,
				name: namespace,
				code: '',
				input: {
					Emit: `${exportName}.emit("${namespace}", { ${ports} });`,
				}
			};
		},
	},

	createRouteCall({ routeIndex }){
		return this.routeFunctionName.replace('{{+bp index }}', routeIndex) + '();';
	},

	generatePortsStorage({ iface, ifaceIndex, ifaceList, variabels, sharedData, routeIndex, outRoutes }){
		let inputs = [], outputs = [];
		let inputAlias = false, outputAlias = false;
		let { IInput, IOutput } = iface.ref;
		let template = sharedData.template.get(iface);

		if(iface.namespace === 'BP/Fn/Output' || iface.namespace === 'BP/Var/Get' || iface.namespace === 'BP/Env/Get')
			return;

		if(IInput != null){
			for (let key in IInput) {
				let port = IInput[key];
				let {default: def, cables} = port;
				let portName = /(^[^a-zA-Z]|\W)/m.test(key) ? JSON.stringify(key) : key;

				let targets = [];
				for (let i=0; i < cables.length; i++) {
					let out = cables[i].output;
					if(out == null || out.isRoute) continue;

					let outTemplate = sharedData.template.get(out.iface);
					if(outTemplate.outputAlias){
						targets.push({alias: outTemplate.outputAlias[out.name]});
						continue;
					}

					let targetIndex = ifaceList.indexOf(out.iface);
					let propAccessName = /(^[^a-zA-Z]|\W)/m.test(out.name) ? JSON.stringify(out.name) : out.name;

					propAccessName = propAccessName.slice(0, 1) === '"' ? '['+propAccessName+']' : '.'+propAccessName;

					targets.push({index: targetIndex, prop: propAccessName});
				}

				if(template.inputAlias?.[key] != null){
					if(port.type === Blackprint.Types.Trigger){
						inputs.push(`async ${portName}(v){ ${template.inputAlias[key]} }`);
					}
					else {
						inputs.push(`set ${portName}(v){ ${template.inputAlias[key]} = v }`);
						inputs.push(`get ${portName}(){ return ${template.inputAlias[key]} }`);
					}
				}
				else if(port.feature === Blackprint.Port.ArrayOf){
					inputs.push(`get ${portName}(){ return [${targets.map(v => `bp_output_${v.index}${v.prop}`).join(',')}] }`);
				}
				else if(def == null){
					let val = targets[0];
					if(val.alias)
						inputs.push(`get ${portName}(){ return ${val.alias} }`);
					else {
						inputs.push(`get ${portName}(){ return bp_output_${val.index}${val.prop} }`);
					}
				}
				else {
					let typed = typeof def;
					let feature = port.feature;

					if(feature === Blackprint.Port.Trigger){
						def = template.input?.[key];
						if(iface.namespace.startsWith('BPI/F/'))
							def = `bp_func_${ifaceIndex}.input[${JSON.stringify(key)}]();`;

						if(def == null)
							throw new Error(`${iface.namespace}: Trigger callback haven't been registered for input port "${key}"`);

						inputs.push(`async ${portName}(Input, Output){ ${def} }`);
						continue;
					}
					else if(feature === Blackprint.Port.ArrayOf) def = [];
					else if(typed !== 'string' && typed !== 'number' && typed !== 'boolean')
						throw new Error(`Can't use default type of non-primitive type for "${key}" input port in "${iface.namespace}"`);

					let val = targets[0];
					if(val == null)
						inputs.push(`${portName}: ${JSON.stringify(def)}`);
					else {
						if(val.alias)
							inputs.push(`get ${portName}(){ return ${val.alias} }`);
						else {
							inputs.push(`get ${portName}(){ return bp_output_${val.index}${val.prop} ?? ${JSON.stringify(def)} }`);
						}
					}
				}
			}
		}

		if(IOutput != null && !template.outputAlias){
			for (let key in IOutput) {
				let portName = /(^[^a-zA-Z]|\W)/m.test(key) ? JSON.stringify(key) : key;
				let port = IOutput[key];

				let targets = [];
				let cables = port.cables;
				for (let i=0; i < cables.length; i++) {
					let inp = cables[i].input;
					if(inp == null || inp.isRoute) continue;

					let inpTemplate = sharedData.template.get(inp.iface);
					if(inpTemplate.inputAlias){
						targets.push({alias: inpTemplate.inputAlias[inp.name]});
						continue;
					}

					let targetIndex = ifaceList.indexOf(inp.iface);
					let propAccessName = jsProp(inp.name);

					targets.push({index: targetIndex, prop: propAccessName, iface: inp.iface});
				}

				if(port.type !== Blackprint.Types.Trigger){
					if(port.isRoute){
						let cables = port.cables;
						let targetIface;
						for (let i=0; i < cables.length; i++) {
							targetIface = cables[i].input?.iface;
							if(targetIface != null) break;
						}

						if(targetIface && sharedData.routeIndexes.has(targetIface)){
							let routeIndex_ = sharedData.routeIndexes.get(targetIface);
							outputs.push(`get ${portName}(){ return bp_route_${routeIndex_}; }`);
							continue;
						}

						// Is not empty route
						if(outRoutes[key] != null){
							outputs.push(`get ${portName}(){ return bp_route_${routeIndex}_${outRoutes[key]}; }`);
							continue;
						}

						outputs.push(`${portName}(){ /* Empty */ }`);
						continue;
					}

					if(template.outputAlias?.[key] != null){
						outputs.push(`set ${portName}(v){ ${template.outputAlias[key]} = v }`);
						outputs.push(`get ${portName}(){ return ${template.outputAlias[key]} }`);
						continue;
					}

					// portIndex++;
					if(targets.length !== 0){
						outputs.push(`${portName}: null`);
					}
					else {
						// Don't store any data if doesn't have cable
						outputs.push(`set ${portName}(v){}`);
						outputs.push(`get ${portName}(){}`);
					}
				}
				else {
					let temp = targets.map(v => {
						if(v.alias) return v.alias;
						if(v.iface.namespace === 'BP/Fn/Output' || v.iface.namespace === 'BP/FnVar/Output'){
							return `await BpFnOutput[${JSON.stringify(key)}]?.();`;
						}

						if(v.iface.namespace === 'BP/Var/Set'){
							return `/* ToDo */`;
						}

						return `await bp_input_${v.index + v.prop}(bp_input_${v.index}, bp_output_${v.index})`;
					});

					outputs.push(`async ${portName}(){ ${temp.join('; ')} }`.replace(/^					/gm, ''));
				}
			}
		}

		if(!variabels.has(ifaceIndex)){
			if(iface.namespace === 'BP/Fn/Input'){
				sharedData.mainShared.fnOutputVar = `bp_output_${ifaceIndex}`;
				outputAlias = '{}';
			}

			let input = '';
			if(inputAlias) input = `let bp_input_${ifaceIndex} = ${inputAlias}; `;
			else if(inputs.length !== 0)
				input = `let bp_input_${ifaceIndex} = {${inputs.join(', ')}}; `;
			else input = `let bp_input_${ifaceIndex} = null;`;

			let output = '';
			if(outputAlias) input = `let bp_output_${ifaceIndex} = ${outputAlias};`;
			else if(outputs.length !== 0)
				output = `let bp_output_${ifaceIndex} = {${outputs.join(', ')}};`;
			else output = `let bp_output_${ifaceIndex} = null;`;

			let fnInstance = '';
			if(iface.namespace.startsWith('BPI/F/')){
				let functionName = iface.namespace.replace('BPI/F/', '');
				fnInstance = `let bp_func_${ifaceIndex} = bp_func["${functionName}"]()`;
			}

			if(inputAlias || outputAlias || inputs.length || outputs.length)
				variabels.set(ifaceIndex, `${input}${output}${fnInstance}`);
		}
	},

	// This will be called everytime code was generated for a node
	onNodeCodeGenerated(result, { data, functionName, routes, iface, ifaceIndex, sharedData, codeClass }){
		let flatFunctionName = functionName.replace(/\W/g, '_');
		let prefix = `${codeClass.isAsync ? 'async ' : ''}`;

		if(data.module){
			/* data.module = {
				"@import/path" : "varAlias",
			}*/

			if(sharedData.moduleImports == null){
				sharedData.moduleImportsCount = 0;
				sharedData.moduleImports = {/*
					"@import/path" : "bpim_1",
				*/};
			}

			let cached = sharedData.moduleImports;
			let modules = data.module;
			for (let key in modules) {
				let name = cached[key];

				if(name == null)
					name = cached[key] = `bpim_${sharedData.moduleImportsCount++}`;

				let temp = modules[key];
				if(temp.constructor === String){ // Name Alias
					if(/\W/.test(temp))
						throw new Error("Variable must be alphanumeric and underscore only");

					dataCodeReplace(data, temp, name);
				}
			}
		}

		if(data.type === Blackprint.CodeType.Callback){
			result.code = `${prefix}function ${flatFunctionName}(Input, Output, Route){\n\t${data.code.replace(/\n/g, '\n\t')}\n}`;
			result.selfRun = data.selfRun;

			if(result.selfRun && this.constructor.routeIn === Blackprint.CodeRoute.MustHave)
				throw new Error(`'selfRun' code can't be used for node that using "CodeRoute.MustHave" for input route`);
		}
		else if(data.type === Blackprint.CodeType.Wrapper){
			let paramInput = '';
			if(iface.namespace === 'BP/Event/Listen')
				paramInput = `\tbp_output_${ifaceIndex} = Input;\n`;

			result.code = `${data.begin}\n${paramInput}\t{{+bp wrap_code_here }}\n${data.end}`;
		}
		else if(data.type === Blackprint.CodeType.NotWrapped){
			sharedData.nodeCodeNotWrapped ??= new Map();
			sharedData.nodeCodeNotWrapped.set(functionName+ifaceIndex, data.code);
		}
		else if(data.type === Blackprint.CodeType.Init){
			sharedData.nodeCodeInit ??= new Map();
			sharedData.nodeCodeInit.set(functionName+ifaceIndex, data.init);
		}
		// Default
		else result.code = `${prefix}function ${flatFunctionName}(Input, Output){ ${data.code.replace(/\n/g, '\n\t')} }`;

		if(iface.namespace === 'BP/Event/Listen'){
			let exported = sharedData.exported ??= {};
			exported[data.name] = {
				iface,
				comment: iface.comment || '',
			};
		}
	},

	generateExecutionTree({
		ifaceIndex, iface, routeIndex, functionName, selfRun, result, codeClass, sharedData
	}){
		let funcInstanceName = functionName.replace(/\W/g, '_');

		if(functionName.startsWith('BPI/F/'))
			funcInstanceName = `bp_func_${ifaceIndex}.call`;

		let prefix = `${codeClass.isReturn ? 'return ' : ''}${codeClass.isAsync ? 'await ' : ''}`;
		if(selfRun){
			result.selfRun += `${prefix}${funcInstanceName}(bp_input_${ifaceIndex}, bp_output_${ifaceIndex}, {Out(){ bp_route_${routeIndex}(); }});`;
		}
		else if(iface.type !== 'event'){
			if(sharedData.nodeCodeNotWrapped?.has(functionName+ifaceIndex)){
				let code = sharedData.nodeCodeNotWrapped.get(functionName+ifaceIndex).replace(/\bInput\b/gm, `bp_input_${ifaceIndex}`).replace(/\bOutput\b/gm, `bp_output_${ifaceIndex}`).replace(/\n/g, '\n\t');

				// Append only if not empty
				if(code.trim()) result.codes.push(code);
				return;
			}

			if(sharedData.nodeCodeInit?.has(functionName+ifaceIndex)) return;

			result.codes.push(`${prefix}${funcInstanceName}(bp_input_${ifaceIndex}, bp_output_${ifaceIndex});`.replace(/^			/gm, ''));
		}
	},

	// You can wrap the generated code from here
	async finalCodeResult(exportName, sharedData, entryPoints){
		if(/(^[^a-zA-Z]|\W)/m.test(exportName)) throw new Error("Export name is a invalid variable name for JavaScript");

		let inits = '';
		if(sharedData.exportName !== false){
			inits += '\n// Node .update() functions\n' + (Object.values(sharedData.nodeCode).join('\n').trim() || '// - This export has no shared function');

			inits += `\n// Application module\nlet ${exportName} = await (async function(){`;
			inits += `\n\tlet exports = new BP_Instance_({Environment: {}});\n\texports.variables = bp_var0;\n\texports.functions = bp_func;`;
		}

		inits += `\n\n\t// ==== Data storages ==== `;

		let varTemp = sharedData.variabels;
		let ifaceList = sharedData.instance.ifaceList;
		for (let [key, val] of varTemp) {
			if(!val) continue;
			inits += `\n\n\t// ${ifaceList[key].namespace}\n\t${val}`;
		}

		let body = ('\n// ==== Begin of exported execution tree as functions ==== \n' + entryPoints.trim()).replace(/\n/g, '\n\t');

		let exported = sharedData.exported;
		let exports = '';
		for (let key in exported) {
			if(exports !== '') exports += '\n\n';
			let temp = exported[key];

			let params = [];
			let output = temp.iface.output;
			for (let key in output) {
				let cables = output[key].cables;
				let type = 'Any';

				if(cables.length !== 0) {
					type = cables[cables.length-1].input?.type?.name || 'Any';
				}

				params.push(`${key}: ${type},`);
			}

			if(params.length !== 0){
				if(params.length === 1) params = `{ ${params[0]} }`;
				else params = `{\n\t${params.join('\n\t')}\n}`;
			}
			else params = '';

			exports += `- ${exportName}.on("${key}", ${params})\n \t=> ${temp.comment}`;
		}

		let imports = [];
		if(sharedData.moduleImports != null){
			let temp = sharedData.moduleImports;
			for (let key in temp)
				imports.push(`let ${temp[key]} = await import(${JSON.stringify(key)});`);
		}

		let information = `/*
This code is automatically generated with Blackprint

Available Events: \n${exports}

*/
${JavaScript_Append}

${imports.join('\n')}
;let bp_var0 = {}; let bp_svar2 = {}; let bp_func = {};
;function bp_callVars(list){ for(let i=0; i < list.length; i++) list[i](); }
`;

		if(sharedData.nodeCodeInit != null){
			for (let [key, val] of sharedData.nodeCodeInit)
				body += '\n\t' + val.replace(/\n/g, '\n\t');
		}

		if(sharedData.exportName === false){
			let variabels = [];

			// Private Vars
			let list2 = Blackprint.Code.utils.getFlatNamespace(sharedData.instance.variables);
			for (let key in list2){
				if(list2[key].type === Blackprint.Types.Trigger)
					variabels.push(`bp_var1[${JSON.stringify(key)}] = [];`);
			}

			// Shared Vars
			let list3 = Blackprint.Code.utils.getFlatNamespace(sharedData.instance.sharedVariables);
			for (let key in list3){
				if(list3[key].type === Blackprint.Types.Trigger)
					variabels.push(`bp_var2[${JSON.stringify(key)}] = [];`);
			}

			if(variabels.length === 0) variabels = '';
			else variabels = '\n' + variabels.join('\n');

			return `\n\tlet bp_var1 = {};` + variabels + inits + '\n\n\t' + body + '\n';
		}
		else {
			let variabels = [];

			// Public Vars
			let list2 = Blackprint.Code.utils.getFlatNamespace(sharedData.instance.variables);
			for (let key in list2){
				if(list2[key].type === Blackprint.Types.Trigger)
					variabels.push(`bp_var0[${JSON.stringify(key)}] = [];`);
			}

			variabels = '\n' + variabels.join('\n');

			// Functions
			let functions = [];
			let list1 = Blackprint.Code.utils.getFlatNamespace(sharedData.instance.functions);
			for (let key in list1) {
				let temp = await Blackprint.Code.utils.createDummyFunction(key, sharedData.instance);
				let bpInstance = temp.iface.bpInstance;

				let fnInput = bpInstance.getNodes('BP/Fn/Input')[0];
				let fnInputCallables = {};

				sharedData.functionTemplate = list1[key];
				let codeTemp = await Blackprint.Code.generateFrom(fnInput.iface, 'js', false, sharedData);
				sharedData.functionTemplate = null;

				[fnInput, ...bpInstance.getNodes('BP/FnVar/Input')].forEach(v => {
					let temp = v.iface.output;
					for (let key in temp) {
						let port = temp[key];
						if(port.type !== Blackprint.Types.Trigger) continue;
						if(v.iface.namespace === 'BP/FnVar/Input')
							key = v.iface.data.name;

						let cables = port.cables;
						let codes = fnInputCallables[key] ??= [];
						for (let i=0; i < cables.length; i++) {
							let cable = cables[i];
							if(cable.input == null) continue;

							let portName = cable.input.name;
							portName = jsProp(portName);

							let targetIndex = bpInstance.ifaceList.indexOf(cable.input.iface);
							codes.push(`bp_input_${targetIndex}${portName}(bp_input_${targetIndex}, bp_output_${targetIndex})`);
						}
					}
				});

				temp.instance.destroy();

				fnInputCallables = Object.entries(fnInputCallables).map(([key, value]) => {
					if(/(^[^a-zA-Z]|\W)/m.test(key)) key = JSON.stringify(key);
					return `${key}(){ ${value.join('; ')} }`
				}).join(', ');

				functions.push(`bp_svar2["${key}"] = {}; bp_func["${key}"] = function(){\n\tlet BpFnOutput = {};\n\tlet bp_var2 = bp_svar2["${key}"];${codeTemp}\n\tlet bp_input = { ${fnInputCallables} };let bp_output = BpFnOutput = {};\n\treturn {\n\t\tinput: bp_input,\n\t\toutput: bp_output,\n\t\tcall: async function(BpFnInput=bp_input, _BpFnOutput=bp_output){\n\t\t\tBpFnOutput = _BpFnOutput;\n\t\t\t${sharedData.fnOutputVar} = BpFnInput;\n\t\t\tbp_route_0_0();\n\t\t\treturn BpFnOutput;\n\t\t}\n\t}\n}`);
			}
			functions = '\n' + functions.join('\n');

			return information + variabels + functions + '\n\n' + inits + '\n\t' + body + `\n\n\treturn exports;\n})();\n\nexport { ${exportName} };`;
		}
	},
});

function jsProp(name){
	let propAccessName = /(^[^a-zA-Z]|\W)/m.test(name) ? JSON.stringify(name) : name;
	propAccessName = propAccessName.slice(0, 1) === '"' ? '['+propAccessName+']' : '.'+propAccessName;

	return propAccessName;
}

function dataCodeReplace(data, name, to){
	let regex = RegExp(`(?<=\\W)${name}(?=[\\.\\[])`, 'mg');
	if(data.code != null) data.code = data.code.replace(regex, to);
	if(data.begin != null) data.begin = data.begin.replace(regex, to);
	if(data.end != null) data.end = data.end.replace(regex, to);
	if(data.init != null) data.init = data.init.replace(regex, to);

	if(data.input != null){
		let obj = data.input;
		for (let key in obj) obj[key] = obj[key].replace(regex, to);
	}
	if(data.inputAlias != null){
		let obj = data.inputAlias;
		for (let key in obj) obj[key] = obj[key].replace(regex, to);
	}
	if(data.output != null){
		let obj = data.output;
		for (let key in obj) obj[key] = obj[key].replace(regex, to);
	}
	if(data.outputAlias != null){
		let obj = data.outputAlias;
		for (let key in obj) obj[key] = obj[key].replace(regex, to);
	}
}