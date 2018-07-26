/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import * as sqlops from 'sqlops';
import * as vscode from 'vscode';
import {ImportDataModel} from './api/dataModel';
import {ImportPage} from './api/importPage';

export class FileConfigPage extends ImportPage {
	private server: sqlops.connection.Connection;

	private serverDropdown: sqlops.DropDownComponent;
	private databaseDropdown: sqlops.DropDownComponent;
	private fileTextBox: sqlops.InputBoxComponent;
	private fileButton: sqlops.ButtonComponent;
	private tableNameTextBox: sqlops.InputBoxComponent;
	private schemaDropdown: sqlops.DropDownComponent;
	private form: sqlops.FormContainer;

	private tableNames: string[] = [];

	public constructor(model: ImportDataModel, view: sqlops.ModelView) {
		super(model, view);
	}

	async start(): Promise<boolean> {
		let schemaComponent = await this.createSchemaDropdown();
		let tableNameComponent = await this.createTableNameBox();
		let fileBrowserComponent = await this.createFileBrowser();
		let databaseComponent = await this.createDatabaseDropdown();
		let serverComponent = await this.createServerDropdown();

		this.form = this.view.modelBuilder.formContainer()
			.withFormItems(
				[
					serverComponent,
					databaseComponent,
					fileBrowserComponent,
					tableNameComponent,
					schemaComponent
				]).component();

		return true;
	}

	async onPageEnter(): Promise<boolean> {
		this.populateServerDropdown().then(this.populateDatabaseDropdown).then(this.populateSchemaDropdown);
		return true;
	}

	async onPageLeave(): Promise<boolean> {
		console.log('left page');
		return true;
	}

	private async populateServerDropdown() {
		let cons = await sqlops.connection.getActiveConnections();
		// This user has no active connections ABORT MISSION
		if (!cons || cons.length === 0) {
			return;
		}

		this.server = cons[0];
		this.model.server = this.server;


		this.serverDropdown.updateProperties({
			values: cons.map(c => {
				let db = c.options.databaseDisplayName;
				let usr = c.options.user;
				let srv = c.options.server;

				if (!db) {
					db = '<default>';
				}

				if (!usr) {
					usr = 'default';
				}

				let finalName = `${srv}, ${db} (${usr})`;
				return {
					connection: c,
					displayName: finalName,
					name: c.connectionId
				};
			})
		});

	}

	private async createDatabaseDropdown(): Promise<sqlops.FormComponent> {
		this.databaseDropdown = this.view.modelBuilder.dropDown().component();

		// Handle database changes
		this.databaseDropdown.onValueChanged(async (db) => {

			this.model.database = (<sqlops.CategoryValue>this.databaseDropdown.value).name;
			this.populateTableNames();
			this.populateSchemaDropdown();
		});

		return {
			component: this.databaseDropdown,
			title: 'Database the table is created in',
		};
	}

	private async createFileBrowser(): Promise<sqlops.FormComponent> {
		this.fileTextBox = this.view.modelBuilder.inputBox().component();
		this.fileButton = this.view.modelBuilder.button().withProperties({
			label: 'Browse'
		}).component();

		this.fileButton.onDidClick(async (click) => {
			//TODO: Add filters for csv and txt
			let fileUris = await vscode.window.showOpenDialog(
				{
					canSelectFiles: true,
					canSelectFolders: false,
					canSelectMany: false,
					openLabel: 'Open',
					filters: {
						'Files': ['csv', 'txt']
					}
				}
			);

			if (!fileUris || fileUris.length === 0) {
				return;
			}

			let fileUri = fileUris[0];
			this.fileTextBox.value = fileUri.fsPath;

			// Get the name of the file.
			let nameStart = fileUri.path.lastIndexOf('/');
			let nameEnd = fileUri.path.lastIndexOf('.');

			// Handle files without extensions
			if (nameEnd === 0) {
				nameEnd = fileUri.path.length;
			}

			this.tableNameTextBox.value = fileUri.path.substring(nameStart + 1, nameEnd);
			this.model.table = this.tableNameTextBox.value;
			this.tableNameTextBox.validate();

			// Let then model know about the file path
			this.model.filePath = fileUri.fsPath;
		});

		return {
			component: this.fileTextBox,
			title: 'Location of file to be imported',
			actions: [this.fileButton]
		};
	}

	private async createTableNameBox(): Promise<sqlops.FormComponent> {
		this.tableNameTextBox = this.view.modelBuilder.inputBox().withValidation((name) => {
			let tableName = name.value;

			if (!tableName || tableName.length === 0) {
				return false;
			}

			if (this.tableNames.indexOf(tableName) !== -1) {
				return false;
			}

			return true;
		}).component();

		this.tableNameTextBox.onTextChanged((tableName) => {
			this.model.table = tableName;
		});

		return {
			component: this.tableNameTextBox,
			title: 'New table name',
		};
	}

	private async createServerDropdown(): Promise<sqlops.FormComponent> {
		this.serverDropdown = this.view.modelBuilder.dropDown().component();

		// Handle server changes
		this.serverDropdown.onValueChanged(async (params) => {
			this.server = (this.serverDropdown.value as ConnectionDropdownValue).connection;

			this.model.server = this.server;
			await this.populateDatabaseDropdown().then(() => this.populateSchemaDropdown());
		});

		return {
			component: this.serverDropdown,
			title: 'Server the database is in',
		};
	}

	private async populateDatabaseDropdown(): Promise<boolean> {
		// Clean out everything

		this.databaseDropdown.updateProperties({values: []});
		this.schemaDropdown.updateProperties({values: []});

		if (!this.server) {
			return false;
		}

		let val: sqlops.CategoryValue[];

		let first = true;
		val = (await sqlops.connection.listDatabases(this.server.connectionId)).map(db => {

			if (first) {
				first = false;
				this.model.database = db;
			}

			return {
				displayName: db,
				name: db
			};
		});

		this.databaseDropdown.updateProperties({
			values: val
		});

		return true;
	}

	private async createSchemaDropdown(): Promise<sqlops.FormComponent> {
		this.schemaDropdown = this.view.modelBuilder.dropDown().component();

		this.schemaDropdown.onValueChanged(() => {
			this.model.schema = (<sqlops.CategoryValue>this.schemaDropdown.value).name;
		});

		return {
			component: this.schemaDropdown,
			title: 'Table schema'
		};

	}

	private async populateSchemaDropdown(): Promise<Boolean> {
		let connectionUri = await sqlops.connection.getUriForConnection(this.server.connectionId);
		let queryProvider = sqlops.dataprotocol.getProvider<sqlops.QueryProvider>(this.server.providerName, sqlops.DataProviderType.QueryProvider);

		let query = `SELECT name FROM sys.schemas`;

		let results = await queryProvider.runQueryAndReturn(connectionUri, query);

		let first = true;
		let schemas = results.rows.map(row => {
			let schemaName = row[0].displayValue;
			if (first) {
				first = false;
				this.model.schema = schemaName;
			}
			let val = row[0].displayValue;

			return {
				name: val,
				displayName: val
			};
		});

		this.schemaDropdown.updateProperties({
			values: schemas
		});
		return true;
	}

	private async populateTableNames(): Promise<boolean> {
		let databaseName = (<sqlops.CategoryValue>this.databaseDropdown.value).name;

		if (!databaseName || databaseName.length === 0) {
			this.tableNames = [];
			return false;
		}

		let connectionUri = await sqlops.connection.getUriForConnection(this.server.connectionId);
		let queryProvider = sqlops.dataprotocol.getProvider<sqlops.QueryProvider>(this.server.providerName, sqlops.DataProviderType.QueryProvider);
		let results: sqlops.SimpleExecuteResult;

		try {

			let query = `USE ${databaseName}; SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'`;
			results = await queryProvider.runQueryAndReturn(connectionUri, query);
		} catch (e) {
			console.log(e);
			return false;
		}

		this.tableNames = results.rows.map(row => {
			return row[0].displayValue;
		});

		console.log(this.tableNames);

		return true;
	}
}


interface ConnectionDropdownValue extends sqlops.CategoryValue {
	connection: sqlops.connection.Connection;
}
