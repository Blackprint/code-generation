Blackprint.Code.registerHandler({
	languageName: 'JavaScript',
	languageId: 'js',

	routeFunction: `function bp_route_{{+bp current_route_name }}(){\n{{+bp wrap_code_here }}\n}`,
	routeFillEmpty: `\t/* Empty route */`,

	// namespace: BP/Event/Listen
	entryPointNode(routes){
		let name = this.iface.data.namespace.replace(/\W/g, '_');

		return {
			type: Blackprint.CodeType.Wrapper,
			name: name,
			begin: `exports.${name} = async function(Input){`,
			end: `}`,
			input: {
				Reset: '/* 1 */',
				Off: '/* 1 */',
			}
		};
	},

	generatePortsStorage({ iface, ifaceIndex, ifaceList, variabels, routeIndex, outRoutes, template }){
		let inputs = [], outputs = [];
		let { IInput, IOutput } = iface.ref;

		if(IInput != null){
			for (let key in IInput) {
				let def = IInput[key].default;
				let portName = /(^[^a-zA-Z]|\W)/m.test(key) ? JSON.stringify(key) : key;

				if(def == null)
					inputs.push(`${portName}: null`);
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

					inputs.push(`${portName}: ${JSON.stringify(def)}`);
				}
			}
		}

		if(IOutput != null){
			// let portIndex = 0;
			for (let key in IOutput) {
				let portName = /(^[^a-zA-Z]|\W)/m.test(key) ? JSON.stringify(key) : key;
				let port = IOutput[key];

				let targets = [];
				let cables = port.cables;
				for (let i=0; i < cables.length; i++) {
					let inp = cables[i].input;
					if(inp == null || inp.isRoute) continue;

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

					// flatten
					targets = targets.map(v => `bp_input_${v.index}${v.prop}`);

					// portIndex++;
					if(targets.length !== 0)
						outputs.push(`set ${portName}(val){ ${targets.join('\n')} = val; }`);

					// Take cached value from other port
					// If possible we should avoid caching data in the output port
					outputs.push(`get ${portName}(){ return ${targets[0]}; }`);
				}
				else {
					let temp = targets.map(v => `bp_input_${temp.index + temp.prop}(bp_input_${temp.index}, bp_output_${temp.index})`);
					outputs.push(`${portName}(){ ${temp.join('; ')} }`.replace(/^					/gm, ''));
				}
			}
		}

		if(!variabels.has(ifaceIndex))
			variabels.set(ifaceIndex, `let bp_input_${ifaceIndex} = {${inputs.join(', ')}}; let bp_output_${ifaceIndex} = {${outputs.join(', ')}};`);
	},

	// This will be called everytime code was generated for a node
	onNodeCodeGenerated(result, { data, functionName, routes, iface, ifaceIndex, sharedData }){
		if(data.type === Blackprint.CodeType.Callback){
			result.code = `function ${functionName}(Input, Output, Route){\n\t${data.code.replace(/\n/g, '\n\t')}\n}`;
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
					paramInput = `\t// To trigger getter and setter\n\tfor(x in bp_output_${ifaceIndex})\n\t\tbp_output_${ifaceIndex}[x] = Input[x];\n\n`;
					break;
				}
			}

			result.code = `${data.begin}\n${paramInput}{{+bp wrap_code_here }}\n${data.end}`;
		}
		else if(data.type === Blackprint.CodeType.NotWrapped){
			sharedData.nodeCodeNotWrapped ??= new Map();
			sharedData.nodeCodeNotWrapped.set(functionName, data.code);
		}
		// Default
		else result.code = `function ${functionName}(Input, Output){ ${data.code} }`;

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
		let prefix = `${codeClass.isReturn ? 'return ' : ''}${codeClass.isAsync ? 'await ' : ''}`;
		if(selfRun){
			result.selfRun += `${prefix}${functionName}(bp_input_${ifaceIndex}, bp_output_${ifaceIndex}, {Out(){ bp_route_${routeIndex}(); }});`;
		}
		else if(iface.type !== 'event'){
			if(sharedData.nodeCodeNotWrapped?.has(functionName)){
				result.codes.push(sharedData.nodeCodeNotWrapped.get(functionName).replace(/\bInput\b/gm, `bp_input_${ifaceIndex}`).replace(/\bOutput\b/gm, `bp_output_${ifaceIndex}`));
				return;
			}

			result.codes.push(`${prefix}${functionName}(bp_input_${ifaceIndex}, bp_output_${ifaceIndex});`.replace(/^			/gm, ''));
		}
	},

	// You can wrap the generated code from here
	finalCodeResult(exportName, sharedData, entryPoints){
		if(/(^[^a-zA-Z]|\W)/m.test(exportName)) throw new Error("Export name is a invalid variable name for JavaScript");

		let inits = `// Application module\nlet ${exportName} = (function(){`;
		inits += `\n\tlet exports = {};`;
		inits += `\n\n\t// Data storages`;
		inits += `\n\t${[...sharedData.variabels.values()].join('\n\t')}`;

		let body = ('// Node .update() functions\n' + ((Object.values(sharedData.nodeCode).join('\n').trim() || '// - This export has no shared function') + '\n\n\n// ==== Begin of exported execution tree as functions ==== \n' + entryPoints.trim()).trim()).replace(/\n/g, '\n\t');

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

			exports += `- ${exportName}.${key}(${params})\n \t=> ${temp.comment}`;
		}

		let information = `/*
This code is automatically generated with Blackprint

Exported functions: \n${exports}

*/

`;

		return information + inits + '\n\n\t' + body + `\n\n\treturn exports;\n})();`;
	},
});