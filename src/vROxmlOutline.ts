import * as vscode from 'vscode';
import * as xml from 'xml2js';
import * as path from 'path';
import * as fs from 'fs';
import * as rest from 'superagent';
import * as yaml from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';

interface RenderKey {
	parentType: string;
	type: string;
	id: string;
	elementName: string;
	metadata?: string;
	title?: string;
}

enum vROruntimes {
	js = "javascript",
	node = "node:12",
	ps = "powercli:11-powershell-6.2",
	python = "python:3.7"
}

interface WfElement {
	name: string;
	title: string;
	script: string;
	inputs: Map<string, string>;
	outputs: Map<string, string>;
	length: number;
	language: string;
	//getSalary: (number) => number; // arrow function
	//getManagerName(number): string;
}

interface vROArtifact {
	fileName: string;
	name: string;
	type: string;
	items: Array<WfElement>;
}

interface vROConfig {
	fqdn: string;
	username: string;
	password: string;
}

export class vROXmlOutlineProvider implements vscode.TreeDataProvider<RenderKey> {

	private _onDidChangeTreeData: vscode.EventEmitter<RenderKey | null> = new vscode.EventEmitter<RenderKey | null>();
	readonly onDidChangeTreeData: vscode.Event<RenderKey | null> = this._onDidChangeTreeData.event;

	private parser = new xml.Parser();

	private artifact: vROArtifact;
	private text: string;
	private editor: vscode.TextEditor;
	private autoRefresh = true;

	constructor(private context: vscode.ExtensionContext) {

		vscode.window.onDidChangeActiveTextEditor(() => this.onActiveEditorChanged());
		vscode.workspace.onDidChangeTextDocument(e => this.onDocumentChanged(e));
		this.parseTree();
		this.autoRefresh = vscode.workspace.getConfiguration('vROxmlOutline').get('autorefresh');
		vscode.workspace.onDidChangeConfiguration(() => {
			this.autoRefresh = vscode.workspace.getConfiguration('vROxmlOutline').get('autorefresh');
		});
		this.onActiveEditorChanged();
	}

	refresh(key?: RenderKey): void {
		this.parseTree();
		if (key) {
			this._onDidChangeTreeData.fire(key);
		} else {
			this._onDidChangeTreeData.fire(undefined);
		}
	}

	pullLatestRepo(uri?: vscode.Uri):void {
		// do stuff
		this.vROPull(uri);
	}

	export(key?: RenderKey): void {
		//export all 
		this.exportArtifactScripts();
	}

	async createAction(offset: any) {
		if (!offset || !offset.path || !offset.path.includes("Actions")) {
			vscode.window.showWarningMessage(`Creating a vRO Action is only supported if doing so in a descendant of the "Actions" folder.`);
			return;
		}
		const opt: vscode.InputBoxOptions = { ignoreFocusOut: true, prompt: "Provide a Name for your Action", validateInput: this.validateLength };

		//get the name of the Action
		const name = await vscode.window.showInputBox(opt);
		if (!name)
			return;
		//now get the number of inputs expected:
		opt.prompt = "How many inputs will your Action expect?";
		opt.value = "0";
		opt.validateInput = (value) => {
			return (isNaN(+value) ? "Please enter a valid number" : "");
		};

		const inputs = new Map<string, string>();
		const inputstr = await vscode.window.showInputBox(opt);
		if (!inputstr)
			return;
		const totalInputs = Number(inputstr);

		for (let i = 0; i < totalInputs; i++) {
			opt.prompt = `What will you call the ${i == 0 ? "1st" : i == 1 ? "2nd" : i == 2 ? "3rd" : String(i + 1) + "th"} input (name)?`;
			opt.value = "input_" + i;
			opt.validateInput = this.validateLength;
			const inputName = await vscode.window.showInputBox(opt);
			if (!inputName)
				return;
			opt.prompt = `What type will [${inputName}] be?`;
			opt.value = "string";
			const inputType = await vscode.window.showInputBox(opt);
			if (!inputType)
				return;
			inputs.set(inputName, inputType);
		}
		opt.prompt = "What type will your Action return? (use void for no return).";
		opt.value = "void";
		opt.validateInput = this.validateLength;
		const returnType = await vscode.window.showInputBox(opt);
		if (!returnType)
			return;
		opt.prompt = "What language will your Action be scripted in?  Valid values are:  js (Regular Javascript),  python (Python),  node (NodeJS), ps (Powershell)";
		opt.value = "js";
		opt.validateInput = this.validateLength;
		const _lang = await vscode.window.showInputBox(opt);

		if (!_lang)
			return;
		let _runtime;
		try {
			_runtime = vROruntimes[_lang];
		}
		catch {//
		}
		//create the Action:
		this.createActionXML(offset.path, name, inputs, returnType, _runtime);
	}

	private vROPull(uri:vscode.Uri): void{
		const config = this.readConfig(uri.fsPath);
		if(config){
			let baseUrl = `https://${config.fqdn}`;
			if(!baseUrl.endsWith("/"))
				baseUrl += "/";
			//token:
			const creds = {username: config.username, password: config.password};
			let subUrl = "csp/gateway/am/api/login?access_token=";
			process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
			rest.post(baseUrl + subUrl)
				.send( creds )
				.end((err, res) => {
					if (err) { 
						vscode.window.showErrorMessage(err); 
						return;
					} 
					//auth token:
					const auth_token = res.body.access_token;
					subUrl = "vco/api/content-repositories/requests/pull";
					rest.post(baseUrl + subUrl)
					.send( {} ) //empty body
					.set("Authorization", `Bearer ${auth_token}`)
					.end((_err, _res) => {
						if (_err) { 
							vscode.window.showErrorMessage(_err); 
							return;
						} 
						console.log(_res.body.url);
						console.log(_res.body.explanation);
						vscode.window.showInformationMessage("Command sent to vRO. Check vRO for status and/or any additional information.");
					});
				});
		}
	}

	private readConfig(filePath:string): vROConfig{
		try{
		const doc = yaml.load(fs.readFileSync(filePath, 'utf8'));
		console.log(doc);
		const config: vROConfig = { fqdn: doc.server.fqdn, username: doc.server.username, password: doc.server.password };
		return config;
		} catch(e){
			//display warning
			return null;
		}
	}

	private createActionXML(folderPath: string, name: string, inputs: Map<string, string>, output: string, language: vROruntimes): void {

		const fileName = path.join(folderPath, name + ".xml");
		let category = "";
		const parts = folderPath.split(path.sep);
		let isBase = false;
		for (let i = 0; i < parts.length; i++) {
			if (isBase) {
				category += category.length > 0 ? `.${parts[i]}` : parts[i];
			} else if (parts[i] == "Actions") {
				isBase = true;
			}
		}
		const action = {
			"dunes-script-module": {
				"$": {
					"name": name,
					"result-type": output,
					"api-version": "6.0.0",
					"id": uuidv4(),
					"version": "0.0.1",
					"category-name": category
				}
			}
		};

		let _script = "//start writing your code!";
		let ext = "js";
		switch (language) {
			default:
				break;
			case vROruntimes.node:
				action["dunes-script-module"]["runtime"] = [vROruntimes.node];
				_script = "exports.handler = (context, inputs, callback) => {\n    console.log('Inputs were ' + JSON.stringify(inputs));\n    callback(undefined, {status: \"done\"});\n}\n";
				break;
			case vROruntimes.ps:
				action["dunes-script-module"]["runtime"] = [vROruntimes.ps];
				_script = "function Handler($context, $inputs) {\r\n    $inputsString = $inputs | ConvertTo-Json -Compress\r\n\r\n    Write-Host \"Inputs were $inputsString\"\r\n\r\n    $output=@{status = 'done'}\r\n\r\n    return $output\r\n}";
				ext = "ps1";
				break;
			case vROruntimes.python:
				action["dunes-script-module"]["runtime"] = [vROruntimes.python];
				_script = "import json\r\n\r\ndef handler(context, inputs):\r\n    jsonOut=json.dumps(inputs, separators=(',', ':'))\r\n    print(\"Inputs were {0}\".format(jsonOut))\r\n\r\n    outputs = {\r\n      \"status\": \"done\"\r\n    }\r\n\r\n    return outputs";
				ext = "py";
				break;
		}

		action["dunes-script-module"]["script"] = [{
			"_": _script,
			"$": { "encoded": "false" }
		}];

		const builder = new xml.Builder({ cdata: true });
		console.debug("Rebuilding XML...");
		const _xml = builder.buildObject(action);
		fs.writeFileSync(fileName, _xml);
		vscode.window.showInformationMessage("Action Created Successfully.");

		const targetFile = fileName.replace(".xml", `__vro-action.${ext}`);

		//console.debug("Extracting Action JS: " + targetJS);
		fs.writeFile(targetFile, _script, (__err) => {
			if (__err) {
				console.error(__err);
			}
		});

		//this.openInUntitled()
		this.showFile(targetFile);
	}

	private validateLength(input: string): string {
		return input.length > 1 ? "" : "Please enter a valid value";
	}

	exportScript(key?: RenderKey): void {
		//export selected script
		if (key) {
			this.exportElementScript(this.getElementByName(key.elementName));
		}
	}

	reinjectScript(key?: RenderKey): void {
		//reinject selected script
		if (key) {
			this.injectScript(this.getElementByName(key.elementName));
		}
	}

	reinjectAll(key?: RenderKey): void {
		//reinject all scripts
		this.injectAllScripts();
	}

	previewScript(key?: RenderKey): void {
		//show selected script
		if (key) {
			const elem = this.getElementByName(key.elementName);
			let _lang = "javascript";
			if (elem.language.startsWith("python")) {
				_lang = "python";
			} else if (elem.language.startsWith("power")) {
				_lang = "powershell";
			}
			this.openInUntitled(elem.script, _lang);
			//vscode.window.showInformationMessage(elem.script);
		}
	}

	private getScriptFileName(elem: WfElement): string {

		let targetFile = "";

		let ext = ".js";

		if (elem.language.startsWith("python")) {
			ext = "py";
		} else if (elem.language.startsWith("power")) {
			ext = "ps1";
		}
		if (this.artifact.type == "Action") {
			targetFile = this.artifact.fileName.replace(".xml", `__vro-action.${ext}`);
		}
		else {
			const newFileName = "_" + elem.name + `__vro-workflow.${ext}`;
			targetFile = this.artifact.fileName.replace(".xml", newFileName);
		}
		return targetFile;
	}

	private openInUntitled(content: string, language?: string) {
		vscode.workspace.openTextDocument({
			language,
			content,
		}).then((document) => { vscode.window.showTextDocument(document); });

	}

	private showFile(path: string) {
		vscode.workspace.openTextDocument(path).then((document) => {
			const options: vscode.TextDocumentShowOptions = { preserveFocus: true, preview: false };
			vscode.window.showTextDocument(document, options);
		});

	}

	private exportElementScript(elem: WfElement): void {

		if (elem.script) {
			const targetJS = this.getScriptFileName(elem);
			if (this.artifact.type == "Action") {
				//console.debug("Extracting Action JS: " + targetJS);
				fs.writeFile(targetJS, elem.script, (__err) => {
					if (__err) {
						console.error(__err);
					}
				});
			} else if (this.artifact.type == "Workflow") {
				//console.debug("Extracting Workflow JS: " + targetJS);
				fs.writeFile(targetJS, elem.script, (__err) => {
					if (__err) {
						console.error(__err);
					}
				});
			}
			//this.openInUntitled()
			this.showFile(targetJS);

		}
	}

	private exportArtifactScripts(): void {

		if (this.artifact) {
			this.artifact.items.forEach(item => {
				this.exportElementScript(item);
			});
		}
	}

	private injectAllScripts(): void {
		this.artifact.items.forEach(item => {
			this.injectScript(item);
		});
	}

	private injectScript(elem: WfElement): void {
		try {
			const xmlFileName = this.artifact.fileName;
			const JsFileName = this.getScriptFileName(elem);
			// determine original XML filename:

			let newXml = null;
			if (!fs.existsSync(JsFileName)) {
				vscode.window.showWarningMessage(`Matching source file for item [${elem.name}] was not found.`);
				return;
			}
			const jsData = fs.readFileSync(JsFileName, { encoding: "utf8", flag: "r" });
			const xmlData = fs.readFileSync(xmlFileName, {
				encoding: "utf8",
				flag: "r",
			});

			this.parser.parseString(xmlData, (_err, result) => {
				newXml = result;
				if (this.artifact.type == "Action") {
					// action file (simple)
					//console.debug("Setting Action Script Content...");
					newXml["dunes-script-module"].script[0]._ = jsData;
				} else {
					// Workflow file (find relevant node and update script in XML)
					for (const element of newXml["ns2:workflow"]["workflow-item"]) {
						if (
							element.$.type === "task" &&
							element.script &&
							element.$.name === elem.name
						) {
							console.debug(
								"Setting Workflow Task Script Content for " + elem.name + "..."
							);
							element.script[0]._ = jsData;
							break;
						}
					}
				}

				// console.debug(newXml);
				if (newXml != null) {
					// Do not process unless we actually have a valid XML file
					const builder = new xml.Builder({ cdata: true });
					console.debug("Rebuilding XML...");
					const _xml = builder.buildObject(newXml);
					fs.writeFileSync(xmlFileName, _xml);

					fs.unlink(JsFileName, (del_err) => {
						if (del_err) {
							console.error(del_err);
							return;
						}
						console.log("Deleted Source JS file: " + JsFileName);
					});

					vscode.window.showInformationMessage(`Code from [${path.basename(JsFileName)}] reinjected to [${path.basename(xmlFileName)}], and extracted code file [${path.basename(JsFileName)}] deleted successfully.`);
					this.refresh();
				}
			});


		} catch (err) {
			console.error(err);
		}
	}

	private onActiveEditorChanged(): void {
		if (vscode.window.activeTextEditor) {
			if (vscode.window.activeTextEditor.document.uri.scheme === 'file') {
				const enabled = vscode.window.activeTextEditor.document.languageId === 'xml';
				vscode.commands.executeCommand('setContext', 'xmlOutlineEnabled', enabled);
				if (enabled) {
					this.refresh();
				}
			}
		} else {
			vscode.commands.executeCommand('setContext', 'xmlOutlineEnabled', false);
		}
	}

	private onDocumentChanged(changeEvent: vscode.TextDocumentChangeEvent): void {
		if (this.autoRefresh && changeEvent.document.uri.toString() === this.editor.document.uri.toString()) {
			for (const change of changeEvent.contentChanges) {
				this.parseTree();
				this._onDidChangeTreeData.fire(void 0);
			}
		}
	}

	private parseTree(): void {
		this.text = '';
		this.artifact = null;
		this.editor = vscode.window.activeTextEditor;
		if (this.editor && this.editor.document) {
			this.text = this.editor.document.getText();
			this.parseXml();
		}
	}

	private parseXml(): any {

		this.artifact = { "name": null, "type": null, "items": new Array<WfElement>(), fileName: this.editor.document.fileName };

		this.parser.parseString(this.text, (_err, result) => {
			if (
				result["dunes-script-module"] &&
				result["dunes-script-module"].script &&
				result["dunes-script-module"].script.length > 0
			) {
				// This is an action and contains a script
				this.artifact.type = "Action";
				this.artifact.name = result["dunes-script-module"].$.name;
				const wfItem: WfElement = this.getActScript(result["dunes-script-module"]);
				this.artifact.items.push(wfItem);


			} else if (result["ns2:workflow"]) {
				// This is a workflow
				this.artifact.type = "Workflow";
				this.artifact.name = path.dirname(this.editor.document.fileName).split(path.sep).pop();
				result["ns2:workflow"]["workflow-item"].forEach((element: { $: { type: string; name: string; }; script: string; }) => {
					// console.debug(element);
					if (element.$.type === "task" && element.script) {

						this.artifact.items.push(this.getWfElement(element));

					}
				}, this);
				// console.log(result["ns2:workflow"]["workflow-item"]);
			}
		}, this);
	}

	private getWfElement(element): WfElement {

		const _lang = element.runtime ? String(element.runtime) : "javascript:es5";
		let content = element.script[0]._;
		let isJS = false;
		if (_lang.startsWith("javascript") || _lang.startsWith("node")) {
			content = this.cleanContent(content);
			isJS = true;
		}

		const inputs = new Map<string, string>();
		const outputs = new Map<string, string>();

		/* global var1:writable, var2:writable */
		let comments = "";
		if (
			element["in-binding"] &&
			element["in-binding"][0] &&
			element["in-binding"][0].bind
		) {
			//console.debug(element["in-binding"][0].bind);
			for (const input of element["in-binding"][0].bind) {
				if (isJS) {
					if (comments.length > 0) {
						comments += ", ";
					}
					comments += input.$.name + ":readonly";
				}
				inputs.set(input.$.name, input.$.type);
			}
		}
		if (
			element["out-binding"] &&
			element["out-binding"][0] &&
			element["out-binding"][0].bind
		) {
			//console.debug(element["out-binding"][0].bind);
			for (const output of element["out-binding"][0].bind) {
				if (isJS) {
					if (comments.length > 0) {
						comments += ", ";
					}
					comments += output.$.name + ":writable";
				}
				outputs.set(output.$.name, output.$.type);
			}
		}
		if (isJS && comments.length > 0) {
			const parts = comments.split(",");
			comments = parts.join(",\r\n");
			comments = "/* global " + comments + " */\r\n";
			//content = comments + content;
			const esLintRulesPattern = /\/\* eslint[\s\S]*?\*\/\n/g;
			let lastIndex = 0;
			let match;
			while ((match = esLintRulesPattern.exec(content))) {
				//console.log(match.index + ' ' + esLintRulesPattern.lastIndex);
				lastIndex = esLintRulesPattern.lastIndex;
			}
			content =
				content.slice(0, lastIndex) + comments + "\n" + content.slice(lastIndex);
		}
		const _name = element.$.name;
		let _title = "Script (" + _name + ")";
		if (element["display-name"] && element["display-name"].length > 0 && element["display-name"][0].length > 0) {
			_title = element["display-name"][0];
		}

		const wfItem: WfElement = {
			name: _name, title: _title, inputs: inputs, outputs: outputs,
			script: content, length: content.split("\n").length,
			language: _lang
		};
		return wfItem;
	}

	private getActScript(element): WfElement {
		const _lang = element.runtime ? String(element.runtime) : "javascript:es5";

		let content = element.script[0]._;
		let isJS = false;
		if (_lang.startsWith("javascript") || _lang.startsWith("node")) {
			content = this.cleanContent(content);
			isJS = true;
		}
		let comments = "";
		const inputs = new Map<string, string>();
		const outputs = new Map<string, string>();

		if (element.param && element.param.length > 0) {
			for (const param of element.param) {
				if (isJS) {
					if (comments.length > 0) {
						comments += ", ";
					}
					comments += param.$.n + ":readonly";
				}
				inputs.set(param.$.n, param.$.t);
			}
			if (isJS && comments.length > 0) {
				const parts = comments.split(",");
				comments = parts.join(",\r\n");
				comments = "/* global " + comments + " */\r\n";
				//content = comments + content;
				const esLintRulesPattern = /\/\* eslint[\s\S]*?\*\/\n/g;
				let lastIndex = 0;
				let match;
				while ((match = esLintRulesPattern.exec(content))) {
					//console.log(match.index + ' ' + esLintRulesPattern.lastIndex);
					lastIndex = esLintRulesPattern.lastIndex;
				}
				content =
					content.slice(0, lastIndex) +
					comments +
					"\n" +
					content.slice(lastIndex);
			}
		}

		if (element.$["result-type"]) {
			outputs.set("Result", element.$["result-type"]);
		}
		const wfItem: WfElement = {
			name: "Script", title: "Script", inputs: inputs, outputs: outputs,
			script: content, length: content.split("\n").length,
			language: _lang
		};
		return wfItem;
	}

	private cleanContent(content): string {
		// Remove /* Comments
		let regex = /\/\* global[\s\S]*?\*\/\n?/g;
		let newContent = content.replace(regex, "");
		// regex = /<\!\[CDATA\[|\]\]>$/g;
		// newContent = newContent.replace(regex, "");
		// Remove multiple line breaks
		regex = /\n\s*\n/g;
		newContent = newContent.replace(regex, "\n");
		// Remove Leading Whitespace
		regex = /^\s*/g;
		newContent = newContent.replace(regex, "");
		return newContent;
	}

	getChildren(key?: RenderKey): Thenable<RenderKey[]> {
		//determine number of classes
		const res = new Array<RenderKey>();
		if (key) {
			switch (key.type) {
				case "script":
					this.artifact.items.forEach(elem => {
						if (elem.name == key.id) {
							res.push({ type: "inputs", parentType: "script", id: key.id, elementName: elem.name });
							res.push({ type: "outputs", parentType: "script", id: key.id, elementName: elem.name });
						}
					});
					break;
				default:
					break;
				case "inputs":
					this.artifact.items.forEach(elem => {
						if (elem.name == key.id) {
							elem.inputs.forEach((_value, _key) => {
								res.push({ type: _value, parentType: key.type, id: _key, elementName: elem.name });
							});
						}
					});
					break;
				case "outputs":
					//inputs, outputs
					this.artifact.items.forEach(elem => {
						if (elem.name == key.id) {
							elem.outputs.forEach((_value, _key) => {
								res.push({ type: _value, parentType: key.type, id: _key, elementName: elem.name });
							});
						}
					});
					break;
				case "Workflow":
					this.artifact.items.forEach((elem) => {
						res.push({ type: "script", parentType: "Workflow", id: elem.name, title: `${elem.title} (${elem.name})`, elementName: elem.name, metadata: elem.language });
					});
					break;
				case "Action":
					this.artifact.items.forEach((elem) => {
						res.push({ type: "script", parentType: "Action", id: elem.name, title: `${elem.title} (${elem.language})`, elementName: elem.name, metadata: elem.language });
					});
					break;

			}
		} else {
			res.push({ type: this.artifact.type, parentType: null, id: this.artifact.type, elementName: null });
		}
		return Promise.resolve(res);
	}


	getTreeItem(key: RenderKey): vscode.TreeItem {
		//if(offset){
		let treeItem: vscode.TreeItem;
		const elem: WfElement = key.elementName ? this.getElementByName(key.elementName) : null;
		switch (key.type) {
			default:
				treeItem = new vscode.TreeItem(key.id + ": " + key.type, vscode.TreeItemCollapsibleState.None);
				break;
			case "inputs":
				treeItem = new vscode.TreeItem(`${key.type} [${elem.inputs.size}]`, elem.inputs.size > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
				break;
			case "outputs":
				treeItem = new vscode.TreeItem(`${key.type} [${elem.outputs.size}]`, elem.outputs.size > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
				break;
			case "script":
				treeItem = new vscode.TreeItem(key.title, vscode.TreeItemCollapsibleState.Expanded);
				treeItem.tooltip = this.getToolTip(elem);
				break;
			case "Workflow":
			case "Action":
				treeItem = new vscode.TreeItem(this.artifact.name, vscode.TreeItemCollapsibleState.Expanded);
				break;
		}
		// treeItem.command = {
		// 	command: 'extension.openXmlSelection',
		// 	title: '',
		// 	arguments: [new vscode.Range(this.editor.document.positionAt(valueNode.offset), this.editor.document.positionAt(valueNode.offset + valueNode.length))]
		// };
		treeItem.iconPath = this.getIcon(key);
		treeItem.contextValue = key.type;
		return treeItem;
		//}
		//return null;
	}

	select(range: vscode.Range) {
		this.editor.selection = new vscode.Selection(range.start, range.end);
	}

	private getToolTip(elem: WfElement): string {
		return `title:${elem.title}\nlanguage: ${elem.language}\nlength: ${elem.length} lines\npreview: ${elem.script.length > 100 ? elem.script.substr(0, 100) + "..." : elem.script}`;
	}

	private getElementByName(name: string): WfElement {
		for (let i = 0; i < this.artifact.items.length; i++) {
			if (this.artifact.items[i].name == name) {
				return this.artifact.items[i];
			}
		}
		return null;
	}

	private getIcon(key: RenderKey): any {
		let image = "";
		switch (key.type) {
			case "inputs":
				image = "input.svg";
				break;
			case "outputs":
				image = "output.svg";
				break;
			case "script":
				image = "js.svg";
				if (key.metadata) {
					if (key.metadata.toLowerCase().startsWith("power")) {
						image = "powershell.svg";
					} else if (key.metadata.toLowerCase().startsWith("python")) {
						image = "python.svg";
					}
					else if (key.metadata.toLowerCase().startsWith("node")) {
						image = "nodejs.svg";
					}
				}
				break;
			case "Action":
			case "Workflow":
				image = 'vro.svg';
				break;
			default:
				if (key.parentType === "inputs")
					image = 'arrow-right.svg';
				else if (key.parentType === "outputs")
					image = 'arrow-left.svg';
				break;
		}
		return {
			light: this.context.asAbsolutePath(path.join('resources', 'light', image)),
			dark: this.context.asAbsolutePath(path.join('resources', 'dark', image))
		};
	}

}