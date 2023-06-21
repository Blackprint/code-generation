Blackprint.Code.registerHandler({
	languageName: 'Python',
	languageId: 'python',

	routeFunction: `def {{+bp current_route_name }}():\n\t{{+bp wrap_code_here }}`,
	routeFunctionName: `bp_route_{{+bp index }}`,
	routeFillEmpty: `pass # Empty route`,

	internalNodes: {
		// namespace: BP/Env/Get
		environmentGet(routes){
			let name = this.iface.data.name;
			let exportName = this.sharedData.mainShared?.exportName || this.sharedData.exportName;

			return {
				type: Blackprint.CodeType.NotWrapped,
				name: name,
				code: ``,
				outputAlias:  {
					Val: `${exportName}.Environment[${JSON.stringify(name)}]`,
				},
			};
		},

		// namespace: BP/Env/Set
		environmentSet(routes){
			let name = this.iface.data.name;
			let exportName = this.sharedData.mainShared?.exportName || this.sharedData.exportName;

			return {
				type: Blackprint.CodeType.NotWrapped,
				name: name,
				code: `${exportName}.Environment[${JSON.stringify(name)}] = Input["Val"]`,
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

					return `bp_input_${input.iface.i}[${JSON.stringify(input.name)}]()`;
				}).filter(v => !!v);

				init = `bp_var${data.scope}["${name}"].append(lambda: (${targets.join(', ')}))`;
				codeType = Blackprint.CodeType.Init;
			}

			return {
				type: codeType,
				name: name, code: '', init,
				outputAlias: {
					Val: `bp_var${data.scope}[${JSON.stringify(name)}]`,
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
				inputAlias.Val = `bp_callVars(bp_var${data.scope}["${name}"])`;
			}
			else code = `bp_var${data.scope}[${JSON.stringify(name)}] = Input["Val"]`;

			return {
				type: Blackprint.CodeType.NotWrapped,
				name: name, code, inputAlias,

				// If the input is Trigger type
				input: {
					Val: `bp_callVars(bp_var${data.scope}["${name}"])`,
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
				code: `bp_func_${ifaceIndex}["call"](bp_input_${ifaceIndex}, bp_output_${ifaceIndex})`,
			};
		},

		functionOutput(routes){
			let {namespace, input, node} = this.iface;

			function getInput(out){
				let ifaceList = node.instance.ifaceList;
				let targetIndex = ifaceList.indexOf(out.iface);
				let propAccessName = JSON.stringify(out.name);
				return `${targetIndex}[${propAccessName}]`;
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

						let key_ = `[${JSON.stringify(key)}]`;
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

						this.code = `# <-- FnOutput\n\t${list.join('; ')}`;
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
				code: `# <-- FnInput`,
			};
		},
		functionVarOutput(routes){
			let name = this.iface.namespace;
			let data = this.iface.data;

			let code = '';
			if(this.iface.input.Val.type === Blackprint.Types.Trigger){
				code = `/* ToDo FnVarOut */`;
			}
			else code = `BpFnOutput["${data.name}"] = Input["Val"]`

			return {
				type: Blackprint.CodeType.NotWrapped,
				name: name, code,

				// If the input is Trigger type
				input: {
					Val: `BpFnOutput["${data.name}"]() if BpFnOutput["${data.name}"] != None else None`,
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
			let name = namespace;
			let flatName = namespace.replace(/\W/g, '_');
			let exportName = this.sharedData.mainShared?.exportName || this.sharedData.exportName;

			return {
				type: Blackprint.CodeType.Wrapper,
				name: name,
				begin: `def ${flatName}(Input):`,
				end: `${exportName}.on("${namespace}", ${flatName})`,
				input: {
					Reset: 'pass # 1',
					Off: 'pass # 1',
				}
			};
		},

		// namespace: BP/Event/Emit
		eventEmit(routes){
			let namespace = this.iface.data.namespace;
			let name = namespace;
			let exportName = this.sharedData.mainShared?.exportName || this.sharedData.exportName;
			let ports = Object.keys(this.iface.input).map(v=> {
				let quoted = JSON.stringify(v);
				return `${quoted}: Input[${quoted}]`;
			}).join(', ');

			return {
				// type: Blackprint.CodeType.Wrapper,
				name: name,
				code: '',
				input: {
					Emit: `${exportName}.emit("${namespace}", { ${ports} })`, // ToDo
				}
			};
		},
	},

	createRouteCall({ routeIndex }){
		return this.routeFunctionName.replace('{{+bp index }}', routeIndex) + '()';
	},

	generatePortsStorage({ iface, ifaceIndex, ifaceList, variabels, sharedData, routeIndex, outRoutes }){
		let inputs = [], outputs = [];
		let inputAlias = false, outputAlias = false;
		let { IInput, IOutput } = iface.ref;
		let template = sharedData.template.get(iface);

		if(iface.namespace === 'BP/Fn/Output' || iface.namespace === 'BP/Var/Get' || iface.namespace === 'BP/Env/Get')
			return;

		let inputFunc = [];
		if(IInput != null){
			for (let key in IInput) {
				let port = IInput[key];
				let {default: def, cables} = port;
				let portName = JSON.stringify(key);
				let portNameFlat = key.replace(/\W/g, '_');

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
					let propAccessName = JSON.stringify(out.name);

					targets.push({index: targetIndex, prop: '['+propAccessName+']'});
				}

				if(template.inputAlias?.[key] != null){
					if(port.type === Blackprint.Types.Trigger){
						inputs.push(`${portName}: [lambda: ${template.inputAlias[key]}]`);
					}
					else {
						inputs.push(`set ${portName}(v){ ${template.inputAlias[key]} = v }`);
						inputs.push(`get ${portName}(){ return ${template.inputAlias[key]} }`);
					}
				}
				else if(port.feature === Blackprint.Port.ArrayOf){
					inputs.push(`${portName}: [lambda: [${targets.map(v => `bp_output_${v.index}${v.prop}`).join(',')}]]`);
				}
				else if(def == null){
					let val = targets[0];
					if(val.alias)
						inputs.push(`${portName}: [lambda: ${val.alias}]`);
					else {
						inputs.push(`${portName}: [lambda: bp_output_${val.index}${val.prop}]`);
					}
				}
				else {
					let typed = typeof def;
					let feature = port.feature;

					if(feature === Blackprint.Port.Trigger){
						def = template.input?.[key];
						if(iface.namespace.startsWith('BPI/F/'))
							def = `bp_func_${ifaceIndex}["input"][${JSON.stringify(key)}]()`;

						if(def == null)
							throw new Error(`${iface.namespace}: Trigger callback haven't been registered for input port "${key}"`);
						
						let inpFuncName = `inp_f_${portNameFlat}${ifaceIndex}`;
						inputFunc.push(`def ${inpFuncName}(Input, Output):\n\t${def}\ndef c_${inpFuncName}(): ${inpFuncName}(bp_input_${ifaceIndex}, bp_output_${ifaceIndex})`);

						inputs.push(`${portName}: [lambda: c_${inpFuncName}]`);
						continue;
					}
					else if(feature === Blackprint.Port.ArrayOf) def = [];
					else if(typed !== 'string' && typed !== 'number' && typed !== 'boolean')
						throw new Error(`Can't use default type of non-primitive type for "${key}" input port in "${iface.namespace}"`);

					if(typed === 'boolean') def = def ? 'True' : 'False';
					else def = def != null ? JSON.stringify(def) : 'None';

					let val = targets[0];
					if(val == null)
						inputs.push(`${portName}: [lambda: ${def}]`);
					else {
						if(val.alias)
							inputs.push(`${portName}: [lambda: ${val.alias}]`);
						else {
							inputs.push(`${portName}: [lambda: bp_output_${val.index}${val.prop} if bp_output_${val.index}${val.prop} != None else ${def}]`);
						}
					}
				}
			}
		}

		let outputFunc = [];
		if(IOutput != null && !template.outputAlias){
			// let portIndex = 0;
			for (let key in IOutput) {
				let portName = JSON.stringify(key);
				let portNameFlat = key.replace(/\W/g, '_');
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
					let propAccessName = JSON.stringify(inp.name);
					propAccessName = `[${propAccessName}]`;

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
							outputs.push(`${portName}: [lambda: bp_route_${routeIndex_}]`);
							continue;
						}

						// Is not empty route
						if(outRoutes[key] != null){
							outputs.push(`${portName}: [lambda: bp_route_${routeIndex}_${outRoutes[key]}]`);
							continue;
						}

						outputs.push(`${portName}: [lambda: bp__NOOP]`);
						continue;
					}

					if(template.outputAlias?.[key] != null){
						let setter = `bp_output_${ifaceIndex}_${portNameFlat}`;
						outputFunc.push(`def ${setter}(v): ${template.outputAlias[key]} = v`);
						outputs.push(`${portName}: [lambda: ${template.outputAlias[key]}, lambda v: ${setter}(v)]`);
						continue;
					}

					// portIndex++;
					if(targets.length === 0) {
						// Don't store any data if doesn't have cable
						outputs.push(`${portName}: [lambda: 0, lambda: 0]`);
						return;
					}

					let getter = `bp_data_${ifaceIndex}[${portName}]`;
					let setter = `bp_output_${ifaceIndex}_${portNameFlat}`;
					outputFunc.push(`def ${setter}(v): ${getter} = v`);
					outputs.push(`${portName}: [lambda: ${getter}, lambda v: ${setter}(v)]`);
				}
				else {
					let temp = targets.map(v => {
						if(v.alias) return v.alias;
						if(v.iface.namespace === 'BP/Fn/Output' || v.iface.namespace === 'BP/FnVar/Output'){
							return `BpFnOutput[${JSON.stringify(key)}]() if BpFnOutput[${JSON.stringify(key)}] != None else None`;
						}

						if(v.iface.namespace === 'BP/Var/Set'){
							return `/* ToDo */`;
						}

						return `bp_input_${v.index + v.prop}()`;
					});

					let outFuncName = `out_f_${portNameFlat}${ifaceIndex}`;
					outputFunc.push(`def ${outFuncName}():\n\t${temp.join('\n\t')}`);
					outputs.push(`${portName}: [lambda: ${outFuncName}]`.replace(/^					/gm, ''));
				}
			}
		}

		inputFunc = inputFunc.join('\n').trim();
		if(inputFunc != '') inputFunc = inputFunc + '\n';
		outputFunc = outputFunc.join('\n').trim();
		if(outputFunc != '') outputFunc = outputFunc + '\n';

		if(!variabels.has(ifaceIndex)){
			if(iface.namespace === 'BP/Fn/Input'){
				sharedData.mainShared.fnOutputVar = `bp_output_${ifaceIndex}`;
				outputAlias = '{}';
			}

			let input = '';
			if(inputAlias) input = `bp_input_${ifaceIndex} = ${inputAlias}`;
			else if(inputs.length !== 0)
				input = `bp_input_${ifaceIndex} = bp_DataStorage_({${inputs.join(', ')}})`;
			else input = `bp_input_${ifaceIndex} = None`;

			if(input) input += '\n';

			let output = '';
			if(outputAlias) input = `bp_output_${ifaceIndex} = ${outputAlias}`;
			else if(outputs.length !== 0){
				output = `bp_output_${ifaceIndex} = bp_DataStorage_({${outputs.join(', ')}})`;

				let props = Object.keys(IOutput).map(v => JSON.stringify(v) + ':None');
				output += `\nbp_data_${ifaceIndex} = {${props.join(', ')}}`
			}
			else output = `bp_output_${ifaceIndex} = None`;

			let fnInstance = '';
			if(iface.namespace.startsWith('BPI/F/')){
				let functionName = iface.namespace.replace('BPI/F/', '');
				fnInstance = `\nbp_func_${ifaceIndex} = bp_func["${functionName}"]()`;
			}

			if(output == '') outputFunc = '';
			if(input == '') inputFunc = '';

			if(inputAlias || outputAlias || inputs.length || outputs.length)
				variabels.set(ifaceIndex, `${inputFunc}${outputFunc}${input}${output}${fnInstance}`);
		}
	},

	// This will be called everytime code was generated for a node
	onNodeCodeGenerated(result, { data, functionName, routes, iface, ifaceIndex, sharedData }){
		let flatFunctionName = functionName.replace(/\W/g, '_');

		if(data.type === Blackprint.CodeType.Callback){
			result.code = `def ${flatFunctionName}(Input, Output, Route):\n\t${data.code.replace(/\n/g, '\n\t')}\n`;
			result.selfRun = data.selfRun;

			if(result.selfRun && this.constructor.routeIn === Blackprint.CodeRoute.MustHave)
				throw new Error(`'selfRun' code can't be used for node that using "CodeRoute.MustHave" for input route`);
		}
		else if(data.type === Blackprint.CodeType.Wrapper){
			let paramInput = '';
			if(iface.namespace === 'BP/Event/Listen'){
				let param = iface.output;

				// Only add if the event have an output (function parameter)
				for (let key in param) {
					paramInput = `\t\t# To trigger getter and setter\n\t\tfor x in bp_output_${ifaceIndex}:\n\t\t\tbp_output_${ifaceIndex}[x] = Input[x] if x in Input else None\n\n`;
					break;
				}
			}

			result.code = `${data.begin}\n${paramInput}\t\t{{+bp wrap_code_here }}\n\t${data.end}`;
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
		else result.code = `def ${flatFunctionName}(Input, Output): \n\t${data.code}`;

		if(iface.namespace === 'BP/Event/Listen'){
			let exported = sharedData.exported ??= {};
			exported[data.name] = {
				iface,
				comment: iface.comment || '',
			};
		}
	},

	generateExecutionTree({
		ifaceIndex, iface, routeIndex, functionName, selfRun, result, codeClass,sharedData
	}){
		let funcInstanceName = functionName.replace(/\W/g, '_');
		if(functionName.startsWith('BPI/F/'))
			funcInstanceName = `bp_func_${ifaceIndex}["call"]`;

		let prefix = `${codeClass.isReturn ? 'return ' : ''}`;
		if(selfRun){
			result.selfRun += `${prefix}${funcInstanceName}(bp_input_${ifaceIndex}, bp_output_${ifaceIndex}, { "Out": lambda: bp_route_${routeIndex}() })`;
		}
		else if(iface.type !== 'event'){
			if(sharedData.nodeCodeNotWrapped?.has(functionName+ifaceIndex)){
				let code = sharedData.nodeCodeNotWrapped.get(functionName+ifaceIndex).replace(/\bInput\b/gm, `bp_input_${ifaceIndex}`).replace(/\bOutput\b/gm, `bp_output_${ifaceIndex}`);

				// Append only if not empty
				if(code.trim()) result.codes.push(code);
				return;
			}

			if(sharedData.nodeCodeInit?.has(functionName+ifaceIndex)) return;

			result.codes.push(`${prefix}${funcInstanceName}(bp_input_${ifaceIndex}, bp_output_${ifaceIndex})`.replace(/^			/gm, ''));
		}
	},

	// You can wrap the generated code from here
	async finalCodeResult(exportName, sharedData, entryPoints){
		if(/(^[^a-zA-Z]|\W)/m.test(exportName)) throw new Error("Export name is a invalid variable name for Python");

		let inits = ``;
		if(sharedData.exportName !== false){
			// inits += ``;
			inits += `\n\n# Application module\n${exportName} = bp_Instance_({"Environment":{}})`;

			inits += '\n\n# Node .update() functions\n' + ((Object.values(sharedData.nodeCode).join('\n').trim() || '# - This export has no shared function'));
		}

		if(exportName)
			inits += `\n\ndef _mainInstance():`;
		else inits += `\n`;

		inits += `\n\t# ==== Data storages ==== `;

		let varTemp = sharedData.variabels;
		let ifaceList = sharedData.instance.ifaceList;
		for (let [key, val] of varTemp) {
			if(!val) continue;
			val = val.split('\n').join('\n\t');
			inits += `\n\n\t# ${ifaceList[key].namespace}\n\t${val}`;
		}

		let entrypoint_ = entryPoints.trim().split('\n').join('\n\t');

		let body = ('\n\t# ==== Begin of exported execution tree as functions ==== \n\t' + entrypoint_).trim();

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

				params.push(`"${key}": ${type},`);
			}

			if(params.length !== 0){
				if(params.length === 1) params = `{ ${params[0]} }`;
				else params = `{\n#   \t${params.join('\n#   \t')}\n#   }`;
			}
			else params = '';

			exports += `# - ${exportName}.on("${key}", ${params})\n# \t=> ${temp.comment}`;
		}

		let imports = ['from BlackprintCodeHelper import bp_DataStorage_, bp_Instance_'];
		let information = `# This code is automatically generated with Blackprint
# 
# Available Events: \n${exports}
# 

${imports.join('\n')}
bp_var0 = {}; bp_svar2 = {}; bp_func = {};
def bp_callVars(list):\n\tfor x in list: x()
def bp__NOOP(): pass
`;
		for (let [key, val] of sharedData.nodeCodeInit)
			body += '\n\t' + val;

		function defaultVal(type){
			if(type === Boolean) return 'False';
			if(type === Number) return '0';
			if(type === String) return '""';
			return 'None';
		}

		if(sharedData.exportName === false){
			let variabels = [];

			// Private Vars
			let list2 = Blackprint.Code.utils.getFlatNamespace(sharedData.instance.variables);
			for (let key in list2){
				let type = list2[key].type;
				if(type === Blackprint.Types.Trigger)
					variabels.push(`bp_var1[${JSON.stringify(key)}] = []`);
				else variabels.push(`bp_var1[${JSON.stringify(key)}] = ${defaultVal(type)}`);
			}

			// Shared Vars
			let list3 = Blackprint.Code.utils.getFlatNamespace(sharedData.instance.sharedVariables);
			for (let key in list3){
				let type = list3[key].type;
				if(type === Blackprint.Types.Trigger)
					variabels.push(`bp_var2[${JSON.stringify(key)}] = []`);
				else variabels.push(`bp_var2[${JSON.stringify(key)}] = ${defaultVal(type)}`);
			}

			if(variabels.length === 0) variabels = '';
			else variabels = '\n\t' + variabels.join('\n\t');

			return `\n\tbp_var1 = {}` + variabels + inits + '\n\n\t' + body + '\n';
		}
		else {
			let variabels = [];

			// Public Vars
			let list2 = Blackprint.Code.utils.getFlatNamespace(sharedData.instance.variables);
			for (let key in list2){
				let type = list2[key].type;
				if(type === Blackprint.Types.Trigger)
					variabels.push(`bp_var0[${JSON.stringify(key)}] = []`);
				else variabels.push(`bp_var0[${JSON.stringify(key)}] = ${defaultVal(type)}`);
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
				let fnInputVar = {};

				sharedData.functionTemplate = list1[key];
				let codeTemp = await Blackprint.Code.generateFrom(fnInput.iface, 'python', false, sharedData);
				sharedData.functionTemplate = null;

				[fnInput, ...bpInstance.getNodes('BP/FnVar/Input')].forEach(v => {
					let temp = v.iface.output;
					for (let key in temp) {
						let port = temp[key];
						if(port.type !== Blackprint.Types.Trigger) {
							fnInputVar[key] ??= true;
							return;
						}

						if(v.iface.namespace === 'BP/FnVar/Input')
							key = v.iface.data.name;

						let cables = port.cables;
						let codes = fnInputCallables[key] ??= [];
						for (let i=0; i < cables.length; i++) {
							let cable = cables[i];
							if(cable.input == null) continue;

							let portName = JSON.stringify(cable.input.name);
							let targetIndex = bpInstance.ifaceList.indexOf(cable.input.iface);
							codes.push(`bp_input_${targetIndex}[${portName}]()`);
						}
					}
				});

				fnInputCallables = Object.entries(fnInputCallables).map(([key, value]) => {
					if(/(^[^a-zA-Z]|\W)/m.test(key)) key = JSON.stringify(key);
					return `"${key}": lambda: (${value.join(', ')})`
				}).join(', ');

				fnInputVar = Object.entries(fnInputVar).map(([key, value]) => {
					return `${JSON.stringify(key)}: None`;
				}).join(', ');

				let fnOutputVar = Object.keys(bpInstance.getNodes('BP/Fn/Output')[0].input).map(v => {
					return `${JSON.stringify(v)}: None`;
				}).join(', ');

				// Destroy instance and delete nodes
				temp.instance.destroy();

				let flatFunctionName = key.replace(/\W/g, '_');
				functions.push(`bp_svar2["${key}"] = {}\ndef bpf_${flatFunctionName}():\n\tBpFnOutput = {}\n\tbp_var2 = bp_svar2["${key}"]${codeTemp}\n\tbp_input = { ${[fnInputCallables, fnInputVar].join(', ')} }; bp_output = BpFnOutput = { ${fnOutputVar} }\n\tdef bp_instanceCall_(BpFnInput=bp_input, _BpFnOutput=bp_output):\n\t\tnonlocal BpFnOutput, ${sharedData.fnOutputVar}\n\t\tBpFnOutput = _BpFnOutput\n\t\t${sharedData.fnOutputVar} = BpFnInput\n\t\tbp_route_0_0()\n\t\treturn BpFnOutput\n\treturn {"input": bp_input, "output": bp_output, "call": bp_instanceCall_}\nbp_func["${key}"] = bpf_${flatFunctionName}`);
			}

			functions = '\n' + functions.join('\n');

			return information + variabels + functions + '\n\n' + inits + '\n\n\t' + body + '\n\tbp_route_0_0()\n\n_mainInstance()';
		}
	},
});