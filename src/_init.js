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

	EntryPointNode.prototype[handler.languageId] = handler.entryPointNode;
}

// Declare function by assigning from the prototype to enjoy hot reload
Blackprint.Code.prototype._generateFor = function(fnName, language, routes, ifaceIndex, sharedData, iface){
	if(this[language] == null)
		throw new Error(`The registered code for "${this.iface.namespace}" doesn't have handler for "${language}" languange`);

	let data = this[language](routes);
	let ret = Object.assign({}, data);

	if(data.code) data.code = tidyLines(data.code);

	handlers[language].onNodeCodeGenerated(ret, {
		codeClass: this.constructor,
		data, functionName: fnName, routes, ifaceIndex, iface,
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
Blackprint.Code.generateFrom = function(node, language, exportName){
	if(language == null) throw new Error("Target language is required to be specified on parameter 2");
	if(!exportName) throw new Error("Export name is required to be specified on parameter 3");
	codesCache = new Map();

	if(handlers[language] == null)
		throw new Error(`Code generation for '${language}' language is not implemented yet`);

	let sharedData = {nodeCode: {}, nodes: [], variabels: new Map(), currentRoute: 0, exported: {}};
	let generated;

	if(node instanceof Blackprint.Engine)
		generated = fromInstance(node, language, sharedData);
	else if(node instanceof Blackprint.Interface){
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
		let handler = codesHandler[iface.namespace];
		let { routeIn } = handler.routeRules?.(iface) || handler;

		if(routeIn === CodeRoute.Optional || routeIn === CodeRoute.None)
			return true;

		if(routeIn === CodeRoute.MustHave){
			if(iface.node.routes.in.length === 0) throw new Error(`Node '${iface.namespace}' must have input route`);

			// Node that have input route can't be the entrypoint
			return false;
		}

		throw new Error("Unrecognized CodeRoute configuration for: " + iface.namespace);
	});

	let codes = [];
	for (let i=0; i < entrypoint.length; i++)
		codes.push(fromNode(entrypoint[i], language, sharedData));

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

	// let scanner = iface;
	// while(scanner != null){
	// 	sharedData.nodes.push(scanner);
	// 	scanner = scanner.node.routes.out?.input.iface;
	// 	if(stopUntil == scanner) break;
	// }

	let handler = handlers[language];

	sharedData.currentRoute++;
	let selfRun = '';
	let outRoutesFunc = '';
	let wrapper = handler.routeFunction || '';
	wrapper = wrapper.replace(/{{\+bp current_route_name }}/g, sharedData.currentRoute+(
		routeIndex != null ? '_'+routeIndex : ''
	));

	let codes = [];
	let variabels = sharedData.variabels;
	while(iface != null){
		let namespace = iface.namespace;
		let code = codesCache.get(iface);
		let ifaceIndex = ifaceList.indexOf(iface);

		if(code == null){
			let clazz = codesHandler[namespace];
			if(clazz == null)
				throw new Error(`Code generation haven't been registered for: ${namespace}`);

			code = new clazz(iface);
			codesCache.set(iface, code);
		}

		routes.routeOut = iface.node.routes.out?.input.iface;

		let fnName = iface.namespace.replace(/\W/g, '_');
		let shared = sharedData.nodeCode[namespace] ??= [];

		let temp = code._generateFor(fnName, language, routes, ifaceIndex, sharedData, iface);
		if(temp.code != null){
			let i = shared.indexOf(temp.code);

			if(temp.code.includes('{{+bp wrap_code_here }}')) wrapper = temp.code;
			else if(i === -1 && temp.type !== Blackprint.CodeType.NotWrapped){
				i = shared.length;
				shared.push(temp.code);
			}
		}

		// Check if output port has route type
		let outs = iface.output;
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
			functionName: fnName, iface, ifaceIndex,
			ifaceList, variabels, selfRun, routeIndex: sharedData.currentRoute, result,
			outRoutes, template: temp,
			codeClass: codesHandler[namespace]
		});

		handler.generateExecutionTree({
			ifaceIndex, iface, routeIndex: sharedData.currentRoute,
			functionName: fnName, codes, selfRun, result,
			outRoutes,
			codeClass: codesHandler[namespace], sharedData,
		});

		selfRun += result.selfRun;

		routes.routeIn = iface;
		routes.traceRoute.push(iface);

		iface = routes.routeOut;
		if(stopUntil == iface) break;
	}

	return selfRun + '\n' + outRoutesFunc + '\n' + wrapper.replace('{{+bp wrap_code_here }}', '\t'+(codes.join('\n\t') || handler.routeFillEmpty));
}

function tidyLines(str){
	str = str.trim();
	let pad = str.split('\n').pop().match(/^[\t ]+/m);
	if(pad == null || pad.index !== 0) return str;
	return str.replace(RegExp('^'+pad[0], 'gm'), '');
}