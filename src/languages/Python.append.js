let Python_Append = `
;;class BP_DataStorage_(object):
	def __init__(self, _data): self._data = _data
	def __getitem__(self, key): return self._data[key][0]()
	def __setitem__(self, key, val): self._data[key][1](val)
	def __iter__(self): return iter(self._data.keys())
	def __len__(self): return dict.__len__(self._data)
	def __delitem__(self, key): dict.__delitem__(self._data, key)
	def __contains__(self, x): return dict.__contains__(self._data, x)
	def get(self, key): return self._data[key][0]()
	def keys(self): return self._data.keys()
	def items(self): return self._data.items()
	def values(self): return self._data.values()

def BP_findFromList_(list, item):
	try: return list.index(item)
	except ValueError: return None

;;class BP_EventEmitter_(object):
	def __init__(this):
		this._events = {}
		this._once = {}

	def on(this, eventName, func, once = False):
		if(' ' in eventName):
			eventName = eventName.split(' ')
			for val in eventName: this.on(val, func, once)
			return

		if(once == False): events = this._events
		else: events = this._once

		if(eventName not in events): events[eventName] = []
		events[eventName].append(func)

	def once(this, eventName, func):
		this.on(eventName, func, True)

	def off(this, eventName, func = None):
		if(' ' in eventName):
			eventName = eventName.split(' ')
			for val in eventName: this.off(val, func)
			return

		if(func == None):
			del this._events[eventName]
			del this._once[eventName]
			return

		if(eventName in this._events):
			_events = this._events[eventName]
			i = BP_findFromList_(_events, func)
			if(i != None): _events.pop(i)

		if(eventName in this._once):
			_once = this._once[eventName]
			i = BP_findFromList_(_once, func)
			if(i != None): _once.pop(i)

	def emit(this, eventName, data=None):
		events = this._events
		once = this._once

		if(eventName in events):
			evs = events[eventName]
			for val in evs: val(data)

		if(eventName in once):
			evs = once[eventName]
			for val in evs: val(data)
			del once[eventName]

;;class BP_Instance_(BP_EventEmitter_):
	def __init__(self, config):
		BP_EventEmitter_.__init__(self)
		self.Environment = config['Environment'] or {}
`.replace(/;;/g, '');