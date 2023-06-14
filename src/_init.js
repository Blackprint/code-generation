Blackprint.Code = class Code {
	constructor(iface){
		this.iface = iface;
		this.node = iface.node;
	}
};

let handlers = Blackprint.Code.handlers = {};
Blackprint.Code.registerHandler = function(handler){
	if(window.sf?.Obj != null){
		sf.Obj.set(handlers, handler.languageId, handler);
	}
	else handlers[handler.languageId] = handler;

	BPEnvSet.prototype[handler.languageId] = handler.internalNodes.environmentSet;
	BPEnvGet.prototype[handler.languageId] = handler.internalNodes.environmentGet;
	BPVarGet.prototype[handler.languageId] = handler.internalNodes.variableGet;
	BPVarSet.prototype[handler.languageId] = handler.internalNodes.variableSet;
	BPFn.prototype[handler.languageId] = handler.internalNodes.function;
	BPFnOutput.prototype[handler.languageId] = handler.internalNodes.functionOutput;
	BPFnInput.prototype[handler.languageId] = handler.internalNodes.functionInput;
	BPFnVarOutput.prototype[handler.languageId] = handler.internalNodes.functionVarOutput;
	BPFnVarInput.prototype[handler.languageId] = handler.internalNodes.functionVarInput;
	BPEventListen.prototype[handler.languageId] = handler.internalNodes.eventListen;
	BPEventEmit.prototype[handler.languageId] = handler.internalNodes.eventEmit;
}

// Declare function by assigning from the prototype to enjoy hot reload
Blackprint.Code.prototype._generateInit = async function(language, routes){
	if(this[language] == null)
		throw new Error(`The registered code for "${this.iface.namespace}" doesn't have handler for "${language}" languange`);

	let data = this[language](routes);
	let ret = Object.assign({}, data);

	if(data.code) data.code = tidyLines(data.code);
	return ret;
}

Blackprint.Code.prototype._generateFor = async function(fnName, language, routes, ifaceIndex, sharedData, iface, ret){
	await handlers[language].onNodeCodeGenerated(ret, {
		codeClass: this.constructor,
		data: ret, functionName: fnName, routes, ifaceIndex, iface,
		sharedData,
	});

	return ret;
}

let codesHandler = Blackprint.Code.codesHandler ??= {};
Blackprint.registerCode = function(namespace, clazz){
	if(!(clazz.prototype instanceof Blackprint.Code))
		throw new Error("Class must be instance of Blackprint.Code");

	// Set default routes
	if(clazz.routeRules == null){
		if(clazz.routeIn == null) clazz.routeIn = Blackprint.CodeRoute.MustHave;
		if(clazz.routeOut == null) clazz.routeOut = Blackprint.CodeRoute.Optional;
	}

	codesHandler[namespace] = clazz;
}

// The generated code may not self execute, and you may need to trigger the execution
// You will also need to have an event node as the entrypoint
// The event node mustn't have input route to be automatically marked as entrypoint
// Some nodes may get skipped if it's not routed from the event node's route
let codesCache;
Blackprint.Code.generateFrom = async function(node, language, exportName, _sharedData){
	if(language == null) throw new Error("Target language is required to be specified on parameter 2");
	if(exportName == null) throw new Error("Export name is required to be specified on parameter 3");
	codesCache = new Map();

	if(handlers[language] == null)
		throw new Error(`Code generation for '${language}' language is not implemented yet`);

	let sharedData = {
		nodeCode: _sharedData?.nodeCode || {},
		nodes: [],
		variabels: new Map(),
		template: new Map(),
		currentRoute: -1,
		exported: {},
		exportName,
		mainShared: _sharedData?.mainShared || _sharedData,
	};

	if(_sharedData) _sharedData.lastSharedData = sharedData;

	let generated;
	if(node instanceof Blackprint.Engine){
		sharedData.instance = node;
		generated = await fromInstance(node, language, sharedData);
	}
	else if(node instanceof Blackprint.Interface || node.namespace != null){
		sharedData.instance = node.node.instance;

		// Scan for input node that was event node type
		let stopUntil = null;
		// ToDo: scan for branching input and separate to different route for simplify the generated code
		generated = await fromNode(node, language, sharedData, stopUntil);
	}
	else throw new Error("First parameter must be instance of Engine or Interface");

	return await handlers[language].finalCodeResult(exportName, sharedData, generated);
}

// This method will scan for nodes that was event node type as the entrypoint
// As event node can self-trigger or triggered by an external event
async function fromInstance(instance, language, sharedData){
	let CodeRoute = Blackprint.CodeRoute;
	let entrypoint = instance.ifaceList.filter(iface => {
		let namespace = iface.namespace;
		if(namespace.startsWith('BPI/F/')) namespace = 'BPI/F';

		let handler = codesHandler[namespace];
		if(handler == null) throw new Error(`Blackprint.Code haven't been registered for: ${namespace}`);
		let { routeIn } = handler.routeRules?.(iface) || handler;

		if(routeIn === CodeRoute.Optional || routeIn === CodeRoute.None)
			return true;

		if(routeIn === CodeRoute.MustHave){
			if(iface.node.routes.in.length === 0) throw new Error(`Node '${namespace}' must have input route`);

			// Node that have input route can't be the entrypoint
			return false;
		}

		throw new Error("Unrecognized CodeRoute configuration for: " + namespace);
	});

	let codes = [];
	for (let i=0; i < entrypoint.length; i++){
		let code = await fromNode(entrypoint[i], language, sharedData);

		// Append only if not empty
		if(code.trim()) codes.push(code);
	}

	// Merge the codes into a string
	let sharedCode = sharedData.nodeCode;
	for (let key in sharedCode)
		sharedCode[key] = sharedCode[key].join('\n\n');

	return codes.join('\n\n');
}

async function fromNode(iface, language, sharedData, stopUntil, routeIndex){
	let routes = {
		traceRoute: [],
		routeIn: null,
		routeOut: null,
	};

	let ifaceList = iface.node.instance.ifaceList;
	let handler = handlers[language];

	sharedData._loopDetect ??= new WeakSet();
	if(sharedData._loopDetect.has(iface)) return ''; /* Possible call stack loop detected */
	sharedData._loopDetect.add(iface);

	// Generate code template cache
	for (let i=0; i < ifaceList.length; i++) {
		let iface_ = ifaceList[i];
		let namespace = iface_.namespace;
		let _namespace = namespace;
		if(namespace.startsWith('BPI/F/')) _namespace = 'BPI/F';

		let code = codesCache.get(iface_);
		if(code == null){
			let clazz = codesHandler[_namespace];
			if(clazz == null)
				throw new Error(`Code generation haven't been registered for: ${_namespace}`);

			code = new clazz(iface_);
			code.sharedData = sharedData;
			code.exportName = sharedData.exportName;
			codesCache.set(iface_, code);
		}

		let temp = await code._generateInit(language, routes);
		sharedData.template.set(iface_, temp);
	}

	let routeByFnCallback = [];
	for (let i=0; i < ifaceList.length; i++) {
		let iface_ = ifaceList[i];
		let temp = sharedData.template.get(iface_);
		await temp.onTemplateCached?.({ sharedData });

		let code = codesCache.get(iface_);
		let ifaceIndex = ifaceList.indexOf(iface_);
		let fnName = iface_.namespace;
		await code._generateFor(fnName, language, routes, ifaceIndex, sharedData, iface_, temp);

		if(iface_.namespace === 'BP/FnVar/Input' || iface_.namespace === 'BP/Fn/Input'){
			let outputs = iface_.output;
			for (let key in outputs) {
				let output = outputs[key];
				if(output.type === Blackprint.Types.Trigger){
					let cables = output.cables;
					for (let i=0; i < cables.length; i++) {
						let cable = cables[i];
						let inIface = cable.input?.iface;
						if(inIface == null || !inIface.node.routes.noUpdate)
							continue;

						routeByFnCallback.push(inIface);
					}
					break;
				}
			}
		}
	}

	// Generate route list
	let routeList = [];
	let iface_ = iface;
	while(iface_ != null){
		routeList.push(iface_);
		iface_ = iface_.node.routes.out?.input.iface;
		if(stopUntil == iface_) break;
	}

	for (let i=0; i < routeByFnCallback.length; i++) {
		if(!routeList.includes(routeByFnCallback[i]))
			routeList.push(routeByFnCallback[i]);
	}

	async function createRouteFunction(){
		sharedData.currentRoute++;
		let routeName = handler.routeFunctionName.replace('{{+bp index }}', sharedData.currentRoute + (routeIndex != null ? '_'+routeIndex : '_0'));
		let wrapper = (handler.routeFunction || '').replace(/{{\+bp current_route_name }}/g, routeName);

		let selfRun = '';
		let prependCode = '';
		let outRoutesFunc = '';
		let codes = [];
		let variabels = sharedData.variabels;
		let routeIndexes = sharedData.routeIndexes ??= new Map();
		for (let i=0; i < routeList.length; i++) {
			let iface_ = routeList[i];

			// if(routeIndexes.has(iface_)) break;

			// Move to different route function
			if(iface_.node.routes.in.length > 1 && i !== 0){
				let nextRouteIndex = (sharedData.currentRoute + 1) + (routeIndex != null ? '_'+routeIndex : '_0');

				routeIndexes.set(iface_, nextRouteIndex);
				routeList = routeList.slice(i);

				if(prependCode !== '') prependCode += '\n';
				prependCode += await createRouteFunction();

				codes.push(handler.createRouteCall({ routeIndex: nextRouteIndex }));
				break;
			}

			let namespace = iface_.namespace;
			let _namespace = namespace;
			if(namespace.startsWith('BPI/F/')) _namespace = 'BPI/F';
			let fnName = iface_.namespace;

			let ifaceIndex = ifaceList.indexOf(iface_);
			routes.routeOut = iface_.node.routes.out?.input.iface;

			let temp = sharedData.template.get(iface_);
			let shared = sharedData.nodeCode[namespace] ??= [];
			if(temp.code != null){
				let i = shared.indexOf(temp.code);

				if(temp.code.includes('{{+bp wrap_code_here }}')){
					if(!temp.selfRun)
						wrapper = wrapper.replace('{{+bp wrap_code_here }}', temp.code);
					else wrapper = temp.code;
				}
				else if(i === -1 && temp.type !== Blackprint.CodeType.NotWrapped){
					i = shared.length;
					shared.push(temp.code);
				}
			}

			// Check if output port has route type
			let outs = iface_.output;
			let out_i = 0;
			let outRoutes = {};
			for (let key in outs) {
				let temp = outs[key];

				if(temp.isRoute){
					let iface_ = temp.cables[0]?.input?.iface;
					if(iface_){
						outRoutes[key] = out_i;
						if(routeIndexes.has(iface_)) continue;

						outRoutesFunc += await fromNode(iface_, language, sharedData, stopUntil, out_i++);
					}
				}
			}

			// All input data will be available after a value was outputted by a node at the end of execution
			// 'bp_input' is raw Object, 'bp_output' also raw Object that may have property of callable function
			let result = {codes, selfRun: ''};
			await handler.generatePortsStorage({
				functionName: fnName, iface: iface_, ifaceIndex, sharedData,
				ifaceList, variabels, selfRun, routeIndex: sharedData.currentRoute, result,
				outRoutes,
				codeClass: codesHandler[_namespace]
			});

			await handler.generateExecutionTree({
				ifaceIndex, iface: iface_, routeIndex: sharedData.currentRoute, sharedData,
				functionName: fnName, codes, selfRun, result,
				outRoutes,
				codeClass: codesHandler[_namespace], sharedData,
			});

			selfRun += result.selfRun;

			routes.routeIn = iface_;
			routes.traceRoute.push(iface_);
			if(stopUntil == iface_) break;
		}

		if(prependCode) prependCode += '\n';
		if(selfRun) selfRun += '\n';
		if(outRoutesFunc) outRoutesFunc += '\n';

		let whiteSpace = wrapper.match(/^\s+(?={{\+bp wrap_code_here }})/m)?.[0] || '';
		let _codes = codes.join('\n'+whiteSpace);

		let wrappedCode = ''
		if(_codes.trim().length !== 0)
			wrappedCode = wrapper.replace('{{+bp wrap_code_here }}', _codes);

		let result = prependCode + selfRun + outRoutesFunc + wrappedCode;
		return result.trim().length === 0 ? '' : result;
	}

	return await createRouteFunction();
}

function tidyLines(str){
	str = str.trim();
	let pad = str.split('\n').pop().match(/^[\t ]+/m);
	if(pad == null || pad.index !== 0) return str;
	return str.replace(RegExp('^'+pad[0], 'gm'), '');
}

Blackprint.Code.utils = {};
Blackprint.Code.utils.getFlatNamespace = getFlatNamespace;
function getFlatNamespace(obj, list={}, current=""){
	for (let key in obj) {
		if(obj[key].constructor === Object)
			getFlatNamespace(obj[key], list, current+key+"/");
		else list[current+key] = obj[key];
	}
	return list;
}

Blackprint.Code.utils.createDummyFunction = async function(namespace, instance){
	let dummy = new Blackprint.Engine();
	dummy.executionOrder.pause = true;
	dummy.pendingRender = true;
	dummy.functions = instance.functions;
	dummy.variables = instance.variables;
	let iface = await dummy.createNode("BPI/F/"+namespace, {data: {pause: true}});

	await new Promise(resolve => setTimeout(resolve, 1));
	if(iface.bpInstance.ifaceList.length === 0) throw "Failed to import function instance on paused engine";

	return { iface, instance: dummy };
}