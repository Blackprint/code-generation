Blackprint.Code.registerHandler({
	languageName: 'Python',
	languageId: 'python',

	routeFunction: `def bp_route_{{+bp current_route_name }}():\n\t{{+bp wrap_code_here }}\n`,
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
				code: `${exportName}.Environment[${JSON.stringify(name)}] = Input.Val`,
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
					Val: `bp_var${data.scope}[${JSON.stringify(name)}]`,
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
				code: `bp_var${data.scope}[${JSON.stringify(name)}] = Input.Val`,
			};
		},

		// namespace: BPI/F/*
		function(routes){
			let name = this.iface.namespace.replace('BPI/F/', '');
			let ifaceIndex = this.iface.node.instance.ifaceList.indexOf(this.iface);

			return {
				type: Blackprint.CodeType.NotWrapped,
				name: name,
				code: `bp_func[${JSON.stringify(name)}](bp_input_${ifaceIndex}, bp_output_${ifaceIndex})`,
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

						this.code = `# <-- FnOutput\n\t${list.join('; ')};`;
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
			let name = namespace;
			let flatName = namespace.replace(/\W/g, '_');
			let exportName = this.sharedData.mainShared?.exportName || this.sharedData.exportName;

			return {
				type: Blackprint.CodeType.Wrapper,
				name: name,
				begin: `def ${flatName}(Input):`,
				end: `${exportName}.on("${namespace}", ${flatName})\n`,
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

	generatePortsStorage({ iface, ifaceIndex, ifaceList, variabels, sharedData, routeIndex, outRoutes }){
		let inputs = [], outputs = [];
		let inputAlias = false, outputAlias = false;
		let { IInput, IOutput } = iface.ref;
		let template = sharedData.template.get(iface);

		let inputFunc = [];
		if(IInput != null){
			for (let key in IInput) {
				let {default: def, feature, cables} = IInput[key];
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
					let setter = `bp_input_${ifaceIndex}_${portNameFlat}`;
					inputFunc.push(`def ${setter}(v): ${template.inputAlias[key]} = v`);
					inputs.push(`${portName}: [lambda: ${template.inputAlias[key]}, lambda v: ${setter}(v)]`);
				}
				else if(feature === Blackprint.Port.ArrayOf){
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
					let feature = IInput[key].feature;

					if(feature === Blackprint.Port.Trigger){
						def = template.input?.[key];
						if(def == null)
							throw new Error(`${iface.namespace}: Trigger callback haven't been registered for input port "${key}"`);
						
						inputFunc.push(`def inp_f_${portNameFlat}(Input, Output):\n\t${def}`);

						inputs.push(`${portName}: lambda: [inp_f_${portNameFlat}(bp_input_${ifaceIndex}, bp_output_${ifaceIndex})]`);
						continue;
					}
					else if(feature === Blackprint.Port.ArrayOf) def = [];
					else if(typed !== 'string' && typed !== 'number' && typed !== 'boolean')
						throw new Error(`Can't use default type of non-primitive type for "${key}" input port in "${iface.namespace}"`);

					if(typed === 'boolean') def = def ? 'True' : 'False';
					else def = def ? JSON.stringify(def) : 'None';

					let val = targets[0];
					if(val == null)
						inputs.push(`${portName}: [lambda: ${def}]`);
					else {
						if(val.alias)
							inputs.push(`${portName}: [lambda: ${val.alias}]`);
						else {
							inputs.push(`${portName}: [lambda: bp_output_${val.index}${val.prop} if bp_output_${val.index}${val.prop} != None else ${JSON.stringify(def)}]`);
						}
					}
				}
			}
		}

		let outputFunc = [];
		if(IOutput != null){
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

					targets.push({index: targetIndex, prop: propAccessName});
				}

				if(port.type !== Function){
					if(port.isRoute){
						outputs.push(`${portName}: [lambda: bp_route_${routeIndex}_${outRoutes[key]}]`);
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
					let temp = targets.map(v => `bp_input_${v.index}${v.prop}()`);
					outputFunc.push(`def out_f_${portNameFlat}():\n\t${temp.join('\n\t')}`);
					outputs.push(`${portName}: [lambda: out_f_${portNameFlat}]`.replace(/^					/gm, ''));
				}
			}
		}

		inputFunc = inputFunc.join('\n').trim();
		if(inputFunc != '') inputFunc = inputFunc + '\n';
		outputFunc = outputFunc.join('\n').trim();
		if(outputFunc != '') outputFunc = outputFunc + '\n';

		if(!variabels.has(ifaceIndex)){
			if(iface.namespace === 'BP/Fn/Input')
				outputAlias = 'BpFnInput';

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

			if(inputAlias || outputAlias || inputs.length || outputs.length)
				variabels.set(ifaceIndex, `${inputFunc}${outputFunc}${input}${output}`);
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
		let flatFunctionName = functionName.replace(/\W/g, '_');
		if(functionName.startsWith('BPI/F/'))
			flatFunctionName = `bp_func["${functionName.slice(6)}"]`;

		let prefix = `${codeClass.isReturn ? 'return ' : ''}`;
		if(selfRun){
			result.selfRun += `${prefix}${flatFunctionName}(bp_input_${ifaceIndex}, bp_output_${ifaceIndex}, { "Out": lambda: bp_route_${routeIndex}() })`;
		}
		else if(iface.type !== 'event'){
			if(sharedData.nodeCodeNotWrapped?.has(functionName+ifaceIndex)){
				let code = sharedData.nodeCodeNotWrapped.get(functionName+ifaceIndex).replace(/\bInput\b/gm, `bp_input_${ifaceIndex}`).replace(/\bOutput\b/gm, `bp_output_${ifaceIndex}`);

				// Append only if not empty
				if(code.trim()) result.codes.push(code);
				return;
			}

			result.codes.push(`${prefix}${flatFunctionName}(bp_input_${ifaceIndex}, bp_output_${ifaceIndex})`.replace(/^			/gm, ''));
		}
	},

	// You can wrap the generated code from here
	finalCodeResult(exportName, sharedData, entryPoints){
		if(/(^[^a-zA-Z]|\W)/m.test(exportName)) throw new Error("Export name is a invalid variable name for Python");

		let inits = ``;
		inits += `from BlackprintCodeHelper import bp_DataStorage_, bp_Instance_`;
		// inits += ``;
		inits += `\n\n# Application module\n${exportName} = bp_Instance_({"Environment":{}})\nbp_var0 = {}\nbp_func = {}`;

		inits += '\n\n# Node .update() functions\n' + ((Object.values(sharedData.nodeCode).join('\n').trim() || '# - This export has no shared function'));

		inits += `\n\n# ==== Data storages ==== `;

		let varTemp = sharedData.variabels;
		let ifaceList = sharedData.instance.ifaceList;
		for (let [key, val] of varTemp) {
			if(!val) continue;
			inits += `\n\n# ${ifaceList[key].namespace}\n${val}`;
		}

		let body = ('\n# ==== Begin of exported execution tree as functions ==== \n' + entryPoints.trim()).trim();

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

		let information = `# This code is automatically generated with Blackprint
# 
# Available Events: \n${exports}
# 

`;
// # Application module\nlet ${exportName} = (function(){
		return information + inits + '\n\n' + body;
	},
});