Blackprint.Code.registerHandler({
	languageName: 'Python',
	languageId: 'python',

	routeFunction: `def bp_route_{{+bp current_route_name }}():\n{{+bp wrap_code_here }}\n`,

	// namespace: BP/Event/Listen
	entryPointNode(routes){
		let name = this.iface.data.namespace.replace(/\W/g, '_');

		return {
			type: Blackprint.CodeType.Wrapper,
			name: name,
			begin: `def ${name}(Input):`,
			end: ``,
		};
	},

	generatePortsStorage({ iface, ifaceIndex, ifaceList, variabels }){
		let inputs = [], outputs = [];
		let { IInput, IOutput } = iface.ref;

		if(IInput != null){
			for (let key in IInput) {
				let def = IInput[key].default;
				let portName = /(^[^a-zA-Z]|\W)/m.test(key) ? JSON.stringify(key) : key;

				if(def == null)
					inputs.push(`"${portName}": None`);
				else {
					let typed = typeof def;
					let feature = IInput[key].feature;

					if(feature === Blackprint.Port.Trigger) def = null;
					else if(feature === Blackprint.Port.ArrayOf) def = [];
					else if(typed !== 'string' && typed !== 'number' && typed !== 'boolean')
						throw new Error(`Can't use default type of non-primitive type for "${key}" input port in "${iface.namespace}"`);

					inputs.push(`"${portName}": ${def != null ? JSON.stringify(def) : 'None'}`);
				}
			}
		}

		if(IOutput != null){
			// let portIndex = 0;
			for (let key in IOutput) {
				let portName = /(^[^a-zA-Z]|\W)/m.test(key) ? JSON.stringify(key) : key;
				let port = IOutput[key];

				let getter = [];
				let setter = [];
				let cables = port.cables;
				for (let i=0; i < cables.length; i++) {
					let inp = cables[i].input;
					if(inp == null) continue;

					let targetIndex = ifaceList.indexOf(inp.iface);
					let propAccessName = JSON.stringify(inp.name);

					if(port.type === Function){
						getter.push(`bp_input_${targetIndex}.call(${propAccessName})`);
						continue;
					}

					setter.push(`set_(bp_input_${targetIndex}, ${propAccessName}, v)`);

					if(getter.length === 0)
						getter.push(`bp_input_${targetIndex}.get(${propAccessName})`);
				}

				if(port.type !== Function){
					// Take cached value from other port
					// If possible we should avoid caching data in the output port
					outputs.push(`"${portName}": [lambda: ${getter[0]}, lambda v: (${setter.join(',')})]`);
				}
				else {
					let targets = `bp_input_${targetIndex}.call(${propAccessName})`;
					outputs.push(`${portName}(){
						# ToDo
						${targets.join('()\t\n')}()
					}`.replace(/^					/gm, ''));
				}
			}
		}

		if(!variabels.has(ifaceIndex))
			variabels.set(ifaceIndex, `bp_input_${ifaceIndex} = {${inputs.join(', ')}}\nbp_output_${ifaceIndex} = DataStorage({${outputs.join(', ')}})`);
	},

	// This will be called everytime code was generated for a node
	onNodeCodeGenerated(result, { data, functionName, routes, iface, ifaceIndex, sharedData }){
		if(data.type === Blackprint.CodeType.Callback){
			result.code = `def ${functionName}(Input, Output, Route):\n\t${data.code.replace(/\n/g, '\n\t')}\n`;
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
					paramInput = `\t# To trigger getter and setter\n\tfor x in bp_output_${ifaceIndex}:\n\t\tbp_output_${ifaceIndex}[x] = Input[x] if x in Input else None\n\n`;
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
		else result.code = `def ${functionName}(Input, Output): \n\t${data.code}`;

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
			result.selfRun += `${prefix}${functionName}(bp_input_${ifaceIndex}, bp_output_${ifaceIndex}, { "Out": lambda: bp_route_${routeIndex}() })`;
		}
		else if(iface.type !== 'event'){
			if(sharedData.nodeCodeNotWrapped?.has(functionName)){
				result.codes.push(sharedData.nodeCodeNotWrapped.get(functionName).replace(/\bInput\b/gm, `bp_input_${ifaceIndex}`).replace(/\bOutput\b/gm, `bp_output_${ifaceIndex}`));
				return;
			}

			result.codes.push(`${prefix}${functionName}(bp_input_${ifaceIndex}, bp_output_${ifaceIndex})`.replace(/^			/gm, ''));
		}
	},

	// You can wrap the generated code from here
	finalCodeResult(exportName, sharedData, entryPoints){
		if(/(^[^a-zA-Z]|\W)/m.test(exportName)) throw new Error("Export name is a invalid variable name for Python");

		let inits = ``;
		inits += `# Data storages`;
		inits += `\nclass DataStorage(object):
	def __init__(self, _data): self._data = _data
	def __getitem__(self, key): return self._data[key][0]()
	def __setitem__(self, key, val): self._data[key][1](val)
	def __iter__(self): return iter(self._data.keys())
	def __len__(self): return dict.__len__(self._data)
	def __delitem__(self, key): dict.__delitem__(self._data, key)
	def __contains__(self, x): return dict.__contains__(self._data, x)
	def call(self, key, val): raise Exception("ToDo")
	def get(self, key): return self._data[key][0]()
	def keys(self): return self._data.keys()
	def items(self): return self._data.items()
	def values(self): return self._data.values()

def set_(obj, key, val): obj[key] = val`;
		inits += `\n\n${[...sharedData.variabels.values()].join('\n')}`;

		let body = ('# Node .update() functions\n' + ((Object.values(sharedData.nodeCode).join('\n').trim() || '# ...') + '\n\n\n# ==== Begin of exported execution tree as functions ==== \n' + entryPoints.trim()).trim());

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

			exports += `# - ${exportName}.${key}(${params})\n# \t=> ${temp.comment}`;
		}

		let information = `# This code is automatically generated with Blackprint
# 
# Exported functions: \n${exports}
# 

`;
// # Application module\nlet ${exportName} = (function(){
		return information + inits + '\n\n' + body;
	},
});