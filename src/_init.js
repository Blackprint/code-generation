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
Blackprint.Code.prototype._generateInit = function(language, routes){
	if(this[language] == null)
		throw new Error(`The registered code for "${this.iface.namespace}" doesn't have handler for "${language}" languange`);

	let data = this[language](routes);
	let ret = Object.assign({}, data);

	if(data.code) data.code = tidyLines(data.code);
	return ret;
}

Blackprint.Code.prototype._generateFor = function(fnName, language, routes, ifaceIndex, sharedData, iface, ret){
	handlers[language].onNodeCodeGenerated(ret, {
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
Blackprint.Code.generateFrom = function(node, language, exportName, _sharedData){
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

	let generated;
	if(node instanceof Blackprint.Engine){
		sharedData.instance = node;
		generated = fromInstance(node, language, sharedData);
	}
	else if(node instanceof Blackprint.Interface || node.namespace != null){
		sharedData.instance = node.node.instance;

		// Scan for input node that was event node type
		let stopUntil = null;
		// ToDo: scan for branching input and separate to different route for simplify the generated code
		generated = fromNode(node, language, sharedData, stopUntil);
	}
	else throw new Error("First parameter must be instance of Engine or Interface");

	return handlers[language].finalCodeResult(exportName, sharedData, generated);
}

// This method will scan for nodes that was event node type as the entrypoint
// As event node can self-trigger or triggered by an external event
function fromInstance(instance, language, sharedData){
	let CodeRoute = Blackprint.CodeRoute;
	let entrypoint = instance.ifaceList.filter(iface => {
		let namespace = iface.namespace;
		if(namespace.startsWith('BPI/F/')) namespace = 'BPI/F';

		let handler = codesHandler[namespace];
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
		let code = fromNode(entrypoint[i], language, sharedData);

		// Append only if not empty
		if(code.trim()) codes.push(code);
	}

	// Merge the codes into a string
	let sharedCode = sharedData.nodeCode;
	for (let key in sharedCode)
		sharedCode[key] = sharedCode[key].join('\n\n');

	return codes.join('\n\n');
}

function fromNode(iface, language, sharedData, stopUntil, routeIndex){
	let routes = {
		traceRoute: [],
		routeIn: null,
		routeOut: null,
	};

	let ifaceList = iface.node.instance.ifaceList;
	let handler = handlers[language];

	let selfRun = '';
	let outRoutesFunc = '';
	let wrapper = handler.routeFunction || '';

	sharedData.currentRoute++;
	wrapper = wrapper.replace(/{{\+bp current_route_name }}/g, sharedData.currentRoute+(
		routeIndex != null ? '_'+routeIndex : '_0'
	));

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

		let temp = code._generateInit(language, routes);
		sharedData.template.set(iface_, temp);
	}

	for (let i=0; i < ifaceList.length; i++) {
		let iface_ = ifaceList[i];
		let temp = sharedData.template.get(iface_);
		temp.onTemplateCached?.({ sharedData });

		let code = codesCache.get(iface_);
		let ifaceIndex = ifaceList.indexOf(iface_);
		let fnName = iface_.namespace;
		code._generateFor(fnName, language, routes, ifaceIndex, sharedData, iface_, temp);
	}

	// Generate route list
	let routeList = [];
	let iface_ = iface;
	while(iface_ != null){
		routeList.push(iface_);
		iface_ = iface_.node.routes.out?.input.iface;
		if(stopUntil == iface_) break;
	}

	let codes = [];
	let variabels = sharedData.variabels;
	for (let i=0; i < routeList.length; i++) {
		let iface_ = routeList[i];
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
					outRoutesFunc += fromNode(iface_, language, sharedData, stopUntil, out_i++);
				}
			}
		}

		// All input data will be available after a value was outputted by a node at the end of execution
		// 'bp_input' is raw Object, 'bp_output' also raw Object that may have property of callable function
		let result = {codes, selfRun: ''};
		handler.generatePortsStorage({
			functionName: fnName, iface: iface_, ifaceIndex, sharedData,
			ifaceList, variabels, selfRun, routeIndex: sharedData.currentRoute, result,
			outRoutes,
			codeClass: codesHandler[_namespace]
		});

		handler.generateExecutionTree({
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

	if(selfRun) selfRun += '\n';
	if(outRoutesFunc) outRoutesFunc += '\n';

	// if(codes.join('\n\t').trim().length === 0) debugger;

	return selfRun + outRoutesFunc + wrapper.replace('{{+bp wrap_code_here }}', '\t'+(codes.join('\n\t') || handler.routeFillEmpty));
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