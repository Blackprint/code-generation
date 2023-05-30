class BPEnvSet extends Blackprint.Code {
	static routeIn = Blackprint.CodeRoute.MustHave;
	static routeOut = Blackprint.CodeRoute.MustHave;
}
Blackprint.registerCode('BP/Env/Set', BPEnvSet);

class BPEnvGet extends Blackprint.Code {
	static routeIn = Blackprint.CodeRoute.Optional;
	static routeOut = Blackprint.CodeRoute.MustHave;
}
Blackprint.registerCode('BP/Env/Get', BPEnvGet);

class BPVarGet extends Blackprint.Code {
	static routeIn = Blackprint.CodeRoute.Optional;
	static routeOut = Blackprint.CodeRoute.MustHave;
}
Blackprint.registerCode('BP/Var/Get', BPVarGet);

class BPVarSet extends Blackprint.Code {
	static routeIn = Blackprint.CodeRoute.MustHave;
	static routeOut = Blackprint.CodeRoute.MustHave;
}
Blackprint.registerCode('BP/Var/Set', BPVarSet);

class BPFn extends Blackprint.Code {
	static routeIn = Blackprint.CodeRoute.MustHave;
	static routeOut = Blackprint.CodeRoute.MustHave;
}
Blackprint.registerCode('BPI/F', BPFn);

class BPFnOutput extends Blackprint.Code {
	static routeIn = Blackprint.CodeRoute.MustHave;
	static routeOut = Blackprint.CodeRoute.None;
}
Blackprint.registerCode('BP/Fn/Output', BPFnOutput);

class BPFnInput extends Blackprint.Code {
	static routeIn = Blackprint.CodeRoute.None;
	static routeOut = Blackprint.CodeRoute.MustHave;
}
Blackprint.registerCode('BP/Fn/Input', BPFnInput);

class BPFnVarOutput extends Blackprint.Code {
	static routeIn = Blackprint.CodeRoute.MustHave;
	static routeOut = Blackprint.CodeRoute.Optional;
}
Blackprint.registerCode('BP/FnVar/Output', BPFnVarOutput);

class BPFnVarInput extends Blackprint.Code {
	static routeIn = Blackprint.CodeRoute.None;
	static routeOut = Blackprint.CodeRoute.None;
}
Blackprint.registerCode('BP/FnVar/Input', BPFnVarInput);

class BPEventListen extends Blackprint.Code {
	static routeIn = Blackprint.CodeRoute.Optional;
	static routeOut = Blackprint.CodeRoute.MustHave;
}
Blackprint.registerCode('BP/Event/Listen', BPEventListen);

class BPEventEmit extends Blackprint.Code {
	static routeIn = Blackprint.CodeRoute.MustHave;
	static routeOut = Blackprint.CodeRoute.MustHave;
}
Blackprint.registerCode('BP/Event/Emit', BPEventEmit);