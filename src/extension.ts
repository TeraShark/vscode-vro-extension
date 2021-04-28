'use strict';

import * as vscode from 'vscode';

import { vROXmlOutlineProvider } from './vROxmlOutline';

export function activate(context: vscode.ExtensionContext) {

	const vROXmlOutLineProvider = new vROXmlOutlineProvider(context);
	vscode.window.registerTreeDataProvider('vROxmlOutline', vROXmlOutLineProvider);
	vscode.commands.registerCommand('vro.createAction', offset => vROXmlOutLineProvider.createAction(offset));
	vscode.commands.registerCommand('vro.createActionBundle', offset => vROXmlOutLineProvider.createActionBundle(offset));
	vscode.commands.registerCommand('vro.sendPullCommand', (config:vscode.Uri) => vROXmlOutLineProvider.pullLatestRepo(config));
	//vscode.commands.registerCommand('myextension.mycommand', (uri:vscode.Uri) => {});
	vscode.commands.registerCommand('vROxmlOutline.export', offset => vROXmlOutLineProvider.export(offset));
	//exportScript
	vscode.commands.registerCommand('vROxmlOutline.exportScript', offset => vROXmlOutLineProvider.exportScript(offset));
	vscode.commands.registerCommand('vROxmlOutline.reinjectScript', offset => vROXmlOutLineProvider.reinjectScript(offset));
	vscode.commands.registerCommand('vROxmlOutline.reinjectAll', offset => vROXmlOutLineProvider.reinjectAll(offset));
	vscode.commands.registerCommand('vROxmlOutline.exportAll', offset => vROXmlOutLineProvider.export(offset));
	vscode.commands.registerCommand('vROxmlOutline.previewScript', offset => vROXmlOutLineProvider.previewScript(offset));
}