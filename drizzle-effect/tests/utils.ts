import type { Schema } from 'effect';
import { expect, type TaskContext } from 'vitest';

const replacer = (_: string, value: any) => {
	return typeof value === 'bigint' ? Number(value) : value;
};

export function expectSchemaShape<T>(
	_t: TaskContext,
	expected: Schema.Schema<T>,
) {
	return {
		from(actual: Schema.Schema<T>) {
			expect(JSON.stringify(actual.ast, replacer, 2)).toBe(
				JSON.stringify(expected.ast, replacer, 2),
			);
		},
	};
}
