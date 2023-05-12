class EntryPointNode extends Blackprint.Code {
	static routeIn = Blackprint.CodeRoute.Optional;
	static routeOut = Blackprint.CodeRoute.MustHave;
}
Blackprint.registerCode('BP/Event/Listen', EntryPointNode);