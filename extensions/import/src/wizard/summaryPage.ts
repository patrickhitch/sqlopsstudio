/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import {ImportPage} from './api/importPage';
import * as sqlops from 'sqlops';
import {ImportDataModel} from './api/models';
import {FlatFileProvider, InsertDataResponse} from '../services/contracts';
import {FlatFileWizard} from './flatFileWizard';

export class SummaryPage extends ImportPage {
	private table: sqlops.TableComponent;
	private statusText: sqlops.TextComponent;
	private loading: sqlops.LoadingComponent;
	private form: sqlops.FormContainer;

	public constructor(instance: FlatFileWizard, model: ImportDataModel, view: sqlops.ModelView, provider: FlatFileProvider) {
		super(instance, model, view, provider);
	}

	async start(): Promise<boolean> {
		this.table = this.view.modelBuilder.table().component();
		this.statusText = this.view.modelBuilder.text().component();
		this.loading = this.view.modelBuilder.loadingComponent().withItem(this.statusText).component();

		this.form = this.view.modelBuilder.formContainer().withFormItems(
			[
				{
					component: this.table,
					title: 'Import information'
				},
				{
					component: this.loading,
					title: 'Import Status'
				}
			]
		).component();

		await this.view.initializeModel(this.form);
		return true;
	}

	async onPageEnter(): Promise<boolean> {
		this.loading.loading = true;
		this.populateTable();
		await this.handleImport();
		this.loading.loading = false;
		this.instance.setImportAnotherFileVisibility(true);

		return true;
	}

	async onPageLeave(): Promise<boolean> {
		this.instance.setImportAnotherFileVisibility(false);

		return true;
	}

	private populateTable() {
		this.table.updateProperties({
			data: [
				['Server name', this.model.server.providerName],
				['Database name', this.model.database],
				['Table name', this.model.table],
				['Table schema', this.model.schema],
				['File to be imported', this.model.filePath]],
			columns: ['Object type', 'Name'],
			width: 600,
			height: 200
		});
	}

	private async handleImport(): Promise<boolean> {
		let changeColumnResults = [];
		this.model.proseColumns.forEach((val, i, arr) => {
			let columnChangeParams = {
				index: i,
				newName: val.columnName,
				newDataType: val.dataType,
				newNullable: val.nullable,
				newInPrimaryKey: val.primaryKey
			};
			changeColumnResults.push(this.provider.sendChangeColumnSettingsRequest(columnChangeParams));
		});

		let result: InsertDataResponse;
		let err;
		try {
			result = await this.provider.sendInsertDataRequest({
				connectionString: await this.getConnectionString(),
				//TODO check what SSMS uses as batch size
				batchSize: 500
			});
		} catch (e) {
			err = e.toString();
		}

		let updateText: string;
		if (!result || !result.result.success) {
			updateText = '✗ ';
			if (!result) {
				updateText += err;
			} else {
				updateText += result.result.errorMessage;
			}
		} else {
			let rows = await this.getCountRowsInserted();
			if (rows < 0) {
				updateText = '✔ Awesome! You have successfully inserted the data into a table.';
			} else {
				updateText = `✔ Awesome! You have successfully inserted ${rows} rows.`;
			}
		}
		this.statusText.updateProperties({
			value: updateText
		});
		return true;
	}

	/**
	 * Gets the connection string to send to the middleware
	 * @returns {Promise<string>}
	 */
	private async getConnectionString(): Promise<string> {
		let options = this.model.server.options;
		let connectionString: string;

		if (options.authenticationType === 'Integrated') {
			connectionString = `Data Source=${options.server + (options.port ? `,${options.port}` : '')};Initial Catalog=${this.model.database};Integrated Security=True`;
		} else {
			let credentials = await sqlops.connection.getCredentials(this.model.server.connectionId);
			connectionString = `Data Source=${options.server + (options.port ? `,${options.port}` : '')};Initial Catalog=${this.model.database};Integrated Security=False;User Id=${options.user};Password=${credentials.password}`;
		}

		return connectionString;
	}

	private async getCountRowsInserted(): Promise<Number> {
		let queryProvider = sqlops.dataprotocol.getProvider<sqlops.QueryProvider>(this.model.server.providerName, sqlops.DataProviderType.QueryProvider);
		let results: sqlops.SimpleExecuteResult;

		try {

			let query = `USE ${this.model.database}; SELECT COUNT(*) FROM ${this.model.table}`;
			queryProvider.runQueryAndReturn(this.model.server.connectionId, query).then((r) => {
				results = r;
			});
			let cell = results.rows[0][0];
			if (!cell || cell.isNull) {
				return -1;
			}
			let numericCell = Number(cell.displayValue);
			if (isNaN(numericCell)) {
				return -1;
			}
			return numericCell;
		} catch (e) {
			return -1;
		}
	}
}