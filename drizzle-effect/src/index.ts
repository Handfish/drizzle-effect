import * as Drizzle from 'drizzle-orm';
import * as DrizzleMysql from 'drizzle-orm/mysql-core';
import * as DrizzlePg from 'drizzle-orm/pg-core';
import * as DrizzleSqlite from 'drizzle-orm/sqlite-core';
import { Schema } from 'effect';

// Core utility types - simplified
type Columns<TTable extends Drizzle.Table> = TTable['_']['columns'];

// Simplified column schema mapping with controlled JSON handling
type ColumnSchema<TColumn extends Drizzle.Column> = TColumn['dataType'] extends 'custom' ? Schema.Schema<any>
	: TColumn['dataType'] extends 'json' ? Schema.Schema<JsonValue> // Use simplified JsonValue
	: TColumn extends { enumValues: [string, ...string[]] }
	? Drizzle.Equal<TColumn['enumValues'], [string, ...string[]]> extends true ? Schema.Schema<string>
	: Schema.Schema<TColumn['enumValues'][number]>
	: TColumn['dataType'] extends 'bigint' ? Schema.Schema<bigint, bigint>
	: TColumn['dataType'] extends 'number'
	? TColumn['columnType'] extends `PgBigInt${number}` ? Schema.Schema<bigint, number>
	: Schema.Schema<number, number>
	: TColumn['dataType'] extends 'string' ? TColumn['columnType'] extends 'PgNumeric' ? Schema.Schema<number, string>
	: TColumn['columnType'] extends 'PgUUID' ? Schema.Schema<string>
	: TColumn['columnType'] extends 'PgDateString' ? Schema.Schema<Date, string>
	: TColumn['columnType'] extends 'PgTimestampString' ? Schema.Schema<Date, string>
	: Schema.Schema<string, string>
	: TColumn['dataType'] extends 'boolean' ? Schema.Schema<boolean>
	: TColumn['dataType'] extends 'date' ? Schema.Schema<Date>
	: Schema.Schema<any>;

// Simplified JSON types to prevent inference explosion
type JsonPrimitive = string | number | boolean | null;
type JsonObject = { readonly [key: string]: unknown }; // Match Schema.Record output
type JsonArray = readonly unknown[]; // Match Schema.Array output
type JsonValue = JsonPrimitive | JsonObject | JsonArray;

// Strict JSON types for full validation
type StrictJsonObject = { readonly [key: string]: StrictJsonValue };
type StrictJsonArray = readonly StrictJsonValue[];
type StrictJsonValue = JsonPrimitive | StrictJsonObject | StrictJsonArray;

// Non-recursive JSON schema to avoid type inference explosion
export const JsonValue = Schema.Union(
	Schema.String,
	Schema.Number,
	Schema.Boolean,
	Schema.Null,
	Schema.Record({ key: Schema.String, value: Schema.Unknown }),
	Schema.Array(Schema.Unknown),
) satisfies Schema.Schema<JsonValue>;

// For cases where you need full JSON validation, use this explicit version
export const StrictJsonValue = Schema.suspend(
	(): Schema.Schema<StrictJsonValue> =>
		Schema.Union(
			Schema.String,
			Schema.Number,
			Schema.Boolean,
			Schema.Null,
			Schema.Record({ key: Schema.String, value: StrictJsonValue }),
			Schema.Array(StrictJsonValue),
		),
);

// Simplified refinement types
type RefineFunction<TTable extends Drizzle.Table> = (
	schemas: { [K in keyof Columns<TTable>]: Schema.Schema<any> },
) => Schema.Schema<any>;

type RefineArg<TTable extends Drizzle.Table> = Schema.Schema<any> | RefineFunction<TTable>;

// Clean refinement type without ugly satisfies
type TableRefine<TTable extends Drizzle.Table> = {
	[K in keyof Columns<TTable>]?: RefineArg<TTable>;
};

// Property signature builders - simplified
type InsertProperty<TColumn extends Drizzle.Column, TKey extends string> = TColumn['_']['notNull'] extends false
	? Schema.PropertySignature<
		'?:',
		Schema.Schema.Type<ColumnSchema<TColumn>> | null | undefined,
		TKey,
		'?:',
		Schema.Schema.Encoded<ColumnSchema<TColumn>> | null | undefined,
		false,
		never
	>
	: TColumn['_']['hasDefault'] extends true ? Schema.PropertySignature<
		'?:',
		Schema.Schema.Type<ColumnSchema<TColumn>> | undefined,
		TKey,
		'?:',
		Schema.Schema.Encoded<ColumnSchema<TColumn>> | undefined,
		true,
		never
	>
	: ColumnSchema<TColumn>;

type SelectProperty<TColumn extends Drizzle.Column> = TColumn['_']['notNull'] extends false
	? Schema.Schema<Schema.Schema.Type<ColumnSchema<TColumn>> | null>
	: ColumnSchema<TColumn>;

// Base schema builders
type InsertColumnSchemas<TTable extends Drizzle.Table> = {
	[K in keyof Columns<TTable>]: InsertProperty<Columns<TTable>[K], K & string>;
};

type SelectColumnSchemas<TTable extends Drizzle.Table> = {
	[K in keyof Columns<TTable>]: SelectProperty<Columns<TTable>[K]>;
};

// Refined schema builders - controlled complexity
type BuildInsertSchema<TTable extends Drizzle.Table, TRefine = {}> = Schema.Struct<
	InsertColumnSchemas<TTable> & TRefine
>;

type BuildSelectSchema<TTable extends Drizzle.Table, TRefine = {}> = Schema.Struct<
	SelectColumnSchemas<TTable> & TRefine
>;

// Clean API functions
export function createInsertSchema<TTable extends Drizzle.Table, TRefine extends TableRefine<TTable> = {}>(
	table: TTable,
	refine?: TRefine,
): BuildInsertSchema<TTable, TRefine> {
	const columns = Drizzle.getTableColumns(table);
	const columnEntries = Object.entries(columns);

	let schemaEntries: Record<string, Schema.Schema.All | Schema.PropertySignature.All> = Object.fromEntries(
		columnEntries.map(([name, column]) => [name, mapColumnToSchema(column)]),
	);

	// Apply refinements
	if (refine) {
		const refinedEntries = Object.entries(refine).map(([name, refineColumn]) => [
			name,
			typeof refineColumn === 'function' && !Schema.isSchema(refineColumn) && !Schema.isPropertySignature(refineColumn)
				? refineColumn(schemaEntries as any)
				: refineColumn,
		]);

		schemaEntries = Object.assign(schemaEntries, Object.fromEntries(refinedEntries));
	}

	// Apply insert-specific optionality rules
	for (const [name, column] of columnEntries) {
		if (!column.notNull) {
			schemaEntries[name] = Schema.optional(
				Schema.NullOr(schemaEntries[name] as Schema.Schema.All),
			);
		} else if (column.hasDefault) {
			schemaEntries[name] = Schema.optional(schemaEntries[name] as Schema.Schema.All);
		}
	}

	return Schema.Struct(schemaEntries) as any;
}

export function createSelectSchema<TTable extends Drizzle.Table, TRefine extends TableRefine<TTable> = {}>(
	table: TTable,
	refine?: TRefine,
): BuildSelectSchema<TTable, TRefine> {
	const columns = Drizzle.getTableColumns(table);
	const columnEntries = Object.entries(columns);

	let schemaEntries: Record<string, Schema.Schema.All | Schema.PropertySignature.All> = Object.fromEntries(
		columnEntries.map(([name, column]) => [name, mapColumnToSchema(column)]),
	);

	// Apply refinements
	if (refine) {
		const refinedEntries = Object.entries(refine).map(([name, refineColumn]) => [
			name,
			typeof refineColumn === 'function' && !Schema.isSchema(refineColumn) && !Schema.isPropertySignature(refineColumn)
				? refineColumn(schemaEntries as any)
				: refineColumn,
		]);

		schemaEntries = Object.assign(schemaEntries, Object.fromEntries(refinedEntries));
	}

	// Apply select-specific nullability rules
	for (const [name, column] of columnEntries) {
		if (!column.notNull) {
			schemaEntries[name] = Schema.NullOr(schemaEntries[name] as Schema.Schema.All);
		}
	}

	return Schema.Struct(schemaEntries) as any;
}

// Column mapping function
function mapColumnToSchema(column: Drizzle.Column): Schema.Schema<any, any> {
	let type: Schema.Schema<any, any> | undefined;

	if (isWithEnum(column)) {
		type = column.enumValues.length
			? Schema.Literal(...column.enumValues)
			: Schema.String;
	}

	if (!type) {
		if (Drizzle.is(column, DrizzlePg.PgUUID)) {
			type = Schema.UUID;
		} else if (column.dataType === 'custom') {
			type = Schema.Any;
		} else if (column.dataType === 'json') {
			type = JsonValue; // Use non-recursive version
		} else if (column.dataType === 'array') {
			type = Schema.Array(
				mapColumnToSchema((column as DrizzlePg.PgArray<any, any>).baseColumn),
			);
		} else if (column.dataType === 'number') {
			type = Schema.Number;
		} else if (column.dataType === 'bigint') {
			type = Schema.BigIntFromSelf;
		} else if (column.dataType === 'boolean') {
			type = Schema.Boolean;
		} else if (column.dataType === 'date') {
			type = Schema.DateFromSelf;
		} else if (column.dataType === 'string') {
			let sType = Schema.String;

			if (
				(Drizzle.is(column, DrizzlePg.PgChar)
					|| Drizzle.is(column, DrizzlePg.PgVarchar)
					|| Drizzle.is(column, DrizzleMysql.MySqlVarChar)
					|| Drizzle.is(column, DrizzleMysql.MySqlVarBinary)
					|| Drizzle.is(column, DrizzleMysql.MySqlChar)
					|| Drizzle.is(column, DrizzleSqlite.SQLiteText))
				&& typeof column.length === 'number'
			) {
				sType = sType.pipe(Schema.maxLength(column.length));
			}

			type = sType;
		}
	}

	return type || Schema.Any;
}

function isWithEnum(
	column: Drizzle.Column,
): column is typeof column & { enumValues: [string, ...string[]] } {
	return (
		'enumValues' in column
		&& Array.isArray(column.enumValues)
		&& column.enumValues.length > 0
	);
}
