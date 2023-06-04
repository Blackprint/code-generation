Blackprint.Code.registerHandler({
	languageName: 'JavaScript',
	languageId: 'js',

	routeFunction: `async function bp_route_{{+bp current_route_name }}(){\n\t{{+bp wrap_code_here }}\n}`,
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

			return {
				type: Blackprint.CodeType.NotWrapped,
				name: name,
				code: ``,
				outputAlias: {
					Val: `bp_var${data.scope}["${name}"]`
				},
			};
		},

		// namespace: BP/Var/Set
		variableSet(routes){
			let data = this.iface.data;
			let name = data.name;

			return {
				type: Blackprint.CodeType.NotWrapped,
				name: name,
				code: `bp_var${data.scope}["${name}"] = Input.Val;`,
			};
		},

		// namespace: BPI/F/*
		function(routes){
			let name = this.iface.namespace.replace('BPI/F/', '');
			let ifaceIndex = this.iface.node.instance.ifaceList.indexOf(this.iface);

			return {
				type: Blackprint.CodeType.NotWrapped,
				name: name,
				code: `await bp_func["${name}"](bp_input_${ifaceIndex}, bp_output_${ifaceIndex});`,
			};
		},

		functionOutput(routes){
			let {namespace, input, node} = this.iface;

			function getInput(out){
				let ifaceList = node.instance.ifaceList;
				let targetIndex = ifaceList.indexOf(out.iface);
				let propAccessName = /(^[^a-zA-Z]|\W)/m.test(out.name) ? JSON.stringify(out.name) : out.name;

				propAccessName = propAccessName.slice(0, 1) === '"' ? '['+propAccessName+']' : '.'+propAccessName;

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
						if(cables.length === 0) continue;

						let key_ = /(^[^a-zA-Z]|\W)/m.test(key) ? JSON.stringify(key) : key;
						key_ = key_.slice(0, 1) === '"' ? '['+key_+']' : '.'+key_;

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

						this.code = `// <-- FnOutput\n\t${list.join('; ')};`;
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

			return {
				type: Blackprint.CodeType.NotWrapped,
				name: name,
				code: `BpFnOutput["${data.name}"] = Input.Val;`,
			};
		},
		functionVarInput(routes){
			let name = this.iface.namespace;
			let data = this.iface.data;
			let instance = this.node.instance;
			let proxyIface = instance.getNodes('BP/Fn/Input')[0].iface;
			let proxyIndex = instance.ifaceList.indexOf(proxyIface);

			return {
				type: Blackprint.CodeType.NotWrapped,
				name: name,
				code: ``,
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

	generatePortsStorage({ iface, ifaceIndex, ifaceList, variabels, sharedData, routeIndex, outRoutes }){
		let inputs = [], outputs = [];
		let inputAlias = false, outputAlias = false;
		let { IInput, IOutput } = iface.ref;
		let template = sharedData.template.get(iface);

		if(IInput != null){
			for (let key in IInput) {
				let {default: def, feature, cables} = IInput[key];
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

				if(template.inputAlias?.[portName] != null){
					inputs.push(`set ${portName}(v){ ${template.inputAlias[portName]} = v }`);
					inputs.push(`get ${portName}(){ return ${template.inputAlias[portName]} }`);
				}
				else if(feature === Blackprint.Port.ArrayOf){
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
					let feature = IInput[key].feature;

					if(feature === Blackprint.Port.Trigger){
						def = template.input?.[key];
						if(def == null)
							throw new Error(`${iface.namespace}: Trigger callback haven't been registered for input port "${key}"`);
						
						inputs.push(`${portName}(Input, Output){ ${def} }`);
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
					let propAccessName = /(^[^a-zA-Z]|\W)/m.test(inp.name) ? JSON.stringify(inp.name) : inp.name;

					propAccessName = propAccessName.slice(0, 1) === '"' ? '['+propAccessName+']' : '.'+propAccessName;

					targets.push({index: targetIndex, prop: propAccessName});
				}

				if(port.type !== Function){
					if(port.isRoute){
						outputs.push(`get ${portName}(){ return bp_route_${routeIndex}_${outRoutes[key]}; }`);
						continue;
					}

					if(template.outputAlias?.[portName] != null){
						outputs.push(`set ${portName}(v){ ${template.outputAlias[portName]} = v }`);
						outputs.push(`get ${portName}(){ return ${template.outputAlias[portName]} }`);
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
					let temp = targets.map(v => `bp_input_${v.index + v.prop}(bp_input_${v.index}, bp_output_${v.index})`);
					outputs.push(`${portName}(){ ${temp.join('; ')} }`.replace(/^					/gm, ''));
				}
			}
		}

		if(!variabels.has(ifaceIndex)){
			if(iface.namespace === 'BP/Fn/Input')
				outputAlias = 'BpFnInput';

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

			if(inputAlias || outputAlias || inputs.length || outputs.length)
				variabels.set(ifaceIndex, `${input}${output}`);
		}
	},

	// This will be called everytime code was generated for a node
	onNodeCodeGenerated(result, { data, functionName, routes, iface, ifaceIndex, sharedData, codeClass }){
		let flatFunctionName = functionName.replace(/\W/g, '_');
		let prefix = `${codeClass.isAsync ? 'async ' : ''}`;

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
		// Default
		else result.code = `${prefix}function ${flatFunctionName}(Input, Output){ ${data.code} }`;

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
		let flatFunctionName = functionName.replace(/\W/g, '_');

		if(functionName.startsWith('BPI/F/'))
		flatFunctionName = `bp_func["${functionName.slice(6)}"]`;

		let prefix = `${codeClass.isReturn ? 'return ' : ''}${codeClass.isAsync ? 'await ' : ''}`;
		if(selfRun){
			result.selfRun += `${prefix}${flatFunctionName}(bp_input_${ifaceIndex}, bp_output_${ifaceIndex}, {Out(){ bp_route_${routeIndex}(); }});`;
		}
		else if(iface.type !== 'event'){
			if(sharedData.nodeCodeNotWrapped?.has(functionName+ifaceIndex)){
				let code = sharedData.nodeCodeNotWrapped.get(functionName+ifaceIndex).replace(/\bInput\b/gm, `bp_input_${ifaceIndex}`).replace(/\bOutput\b/gm, `bp_output_${ifaceIndex}`);

				// Append only if not empty
				if(code.trim()) result.codes.push(code);
				return;
			}

			result.codes.push(`${prefix}${flatFunctionName}(bp_input_${ifaceIndex}, bp_output_${ifaceIndex});`.replace(/^			/gm, ''));
		}
	},

	// You can wrap the generated code from here
	finalCodeResult(exportName, sharedData, entryPoints){
		if(/(^[^a-zA-Z]|\W)/m.test(exportName)) throw new Error("Export name is a invalid variable name for JavaScript");

		let inits = '';
		if(sharedData.exportName !== false){
			inits += '\n// Node .update() functions\n' + (Object.values(sharedData.nodeCode).join('\n').trim() || '// - This export has no shared function');

			inits += `\n// Application module\nlet ${exportName} = await (async function(){`;
			inits += `\n\tlet exports = new globalThis.BlackprintCodeHelper.Instance({Environment: {}});`;
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
		
		let information = `/*
This code is automatically generated with Blackprint

Available Events: \n${exports}

*/

;let bp_var0 = {}; let bp_func = {};
`;

		if(sharedData.exportName === false){
			// Private Vars
			let variabels = [];
			let list2 = Blackprint.Code.utils.getFlatNamespace(sharedData.instance.variables);
			for (let key in list2)
				variabels.push(`bp_var1["${key}"] = null;`);

			// Shared Vars
			let list3 = Blackprint.Code.utils.getFlatNamespace(sharedData.instance.sharedVariables);
			for (let key in list3)
				variabels.push(`bp_var2["${key}"] = null;`);

			if(variabels.length === 0) variabels = '';
			else variabels = '\n' + variabels.join('\n');

			return `\n\tlet bp_var1 = {}; let bp_var2 = {};` + variabels + inits + '\n\n\t' + body + '\n';
		}
		else {
			// Public Vars
			let variabels = [];
			let list2 = Blackprint.Code.utils.getFlatNamespace(sharedData.instance.variables);
			for (let key in list2)
				variabels.push(`bp_var0["${key}"] = null;`);

			variabels = '\n' + variabels.join('\n');

			// Functions
			let functions = [];
			let list1 = Blackprint.Code.utils.getFlatNamespace(sharedData.instance.functions);
			for (let key in list1) {
				let temp = new Blackprint.Skeleton(list1[key].structure);
				let codeTemp = Blackprint.Code.generateFrom(temp.ifaceList[0], 'js', false, sharedData);

				functions.push(`bp_func["${key}"] = async function(BpFnInput, BpFnOutput={}){${codeTemp}\n\tawait bp_route_0_0(); return BpFnOutput;\n}`);
			}
			functions = '\n' + functions.join('\n');

			return information + declareInit + variabels + functions + '\n\n' + inits + '\n\t' + body + `\n\n\treturn exports;\n})();\n\nexport { ${exportName} };`;
		}
	},
});