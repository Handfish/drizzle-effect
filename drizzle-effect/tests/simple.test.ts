import { Schema, Either } from 'effect';
import * as DrizzlePg from 'drizzle-orm/pg-core';
import { expect, test } from 'vitest';
import { createInsertSchema, createSelectSchema } from '../src/index.ts';

// Simple table with JSONB columns
const courseTable = DrizzlePg.pgTable('courses', {
  id: DrizzlePg.serial('id').primaryKey(),
  title: DrizzlePg.varchar('title', { length: 255 }).notNull(),
  courseData: DrizzlePg.jsonb('course_data').default({}),
  progressData: DrizzlePg.jsonb('progress_data'),
  metadata: DrizzlePg.jsonb('metadata').default({}),
  settings: DrizzlePg.jsonb('settings').default({}),
  createdAt: DrizzlePg.timestamp('created_at').defaultNow().notNull(),
  updatedAt: DrizzlePg.timestamp('updated_at').defaultNow().notNull(),
});

// Simple schemas for JSONB fields
const CourseDataSchema = Schema.Struct({
  difficulty: Schema.Literal('beginner', 'intermediate', 'advanced'),
  category: Schema.String,
  tags: Schema.Array(Schema.String)
});

const ProgressDataSchema = Schema.Struct({
  completionPercentage: Schema.Number.pipe(Schema.between(0, 100)),
  lastAccessed: Schema.DateFromString
});

const MetadataSchema = Schema.Struct({
  description: Schema.String,
  keywords: Schema.Array(Schema.String)
});

const SettingsSchema = Schema.Struct({
  theme: Schema.Literal('light', 'dark'),
  notifications: Schema.Boolean
});

// Simple test data
const validCourseData = {
  difficulty: 'beginner' as const,
  category: 'Programming',
  tags: ['javascript', 'web']
};

const validProgressData = {
  completionPercentage: 50,
  lastAccessed: '2024-01-15T10:30:00Z'
};

const validMetadata = {
  description: 'Learn JavaScript basics',
  keywords: ['javascript', 'programming']
};

const validSettings = {
  theme: 'light' as const,
  notifications: true
};

const validCourse = {
  id: 1,
  title: 'JavaScript Basics',
  courseData: validCourseData,
  progressData: validProgressData,
  metadata: validMetadata,
  settings: validSettings,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-15T12:00:00Z')
};

// Base case tests
test('insert schema with valid data', () => {
  const schema = createInsertSchema(courseTable, {
    courseData: CourseDataSchema,
    progressData: ProgressDataSchema,
    metadata: MetadataSchema,
    settings: SettingsSchema
  });

  const result = Schema.decodeEither(schema)(validCourse);
  expect(Either.isRight(result)).toBeTruthy();
});

test('insert schema with invalid enum value', () => {
  const schema = createInsertSchema(courseTable, {
    courseData: CourseDataSchema
  });

  const invalidCourse = {
    ...validCourse,
    courseData: {
      ...validCourseData,
      difficulty: 'expert' // invalid - should be 'beginner' | 'intermediate' | 'advanced'
    }
  };

  const result = Schema.decodeUnknownEither(schema)(invalidCourse);
  expect(Either.isLeft(result)).toBeTruthy();
});

test('insert schema with out of range number', () => {
  const schema = createInsertSchema(courseTable, {
    progressData: ProgressDataSchema
  });

  const invalidCourse = {
    ...validCourse,
    progressData: {
      ...validProgressData,
      completionPercentage: 150 // invalid - should be 0-100
    }
  };

  const result = Schema.decodeUnknownEither(schema)(invalidCourse);
  expect(Either.isLeft(result)).toBeTruthy();
});

test('insert schema with missing required field', () => {
  const schema = createInsertSchema(courseTable, {
    courseData: CourseDataSchema
  });

  const invalidCourse = {
    ...validCourse,
    courseData: {
      difficulty: 'beginner' as const,
      tags: ['javascript']
      // missing required 'category' field
    }
  };

  const result = Schema.decodeUnknownEither(schema)(invalidCourse);
  expect(Either.isLeft(result)).toBeTruthy();
});

test('insert schema with wrong data type', () => {
  const schema = createInsertSchema(courseTable, {
    courseData: CourseDataSchema
  });

  const invalidCourse = {
    ...validCourse,
    courseData: 'should-be-object-not-string'
  };

  const result = Schema.decodeUnknownEither(schema)(invalidCourse);
  expect(Either.isLeft(result)).toBeTruthy();
});

test('insert schema with refinements validates correctly', () => {
  const schema = createInsertSchema(courseTable, {
    title: ({ title }) => title.pipe(Schema.minLength(3)),
    courseData: CourseDataSchema
  });

  // Valid case - title has min length 3
  const validData = {
    title: 'JavaScript Course',
    courseData: validCourseData
  };
  const validResult = Schema.decodeEither(schema)(validData);
  expect(Either.isRight(validResult)).toBeTruthy();

  // Invalid case - title too short
  const invalidData = {
    title: 'JS', // only 2 characters
    courseData: validCourseData
  };
  const invalidResult = Schema.decodeUnknownEither(schema)(invalidData);
  expect(Either.isLeft(invalidResult)).toBeTruthy();
});

test('select schema decodes complete objects', () => {
  const schema = createSelectSchema(courseTable, {
    courseData: CourseDataSchema,
    progressData: ProgressDataSchema
  });

  // All fields present
  const completeData = {
    id: 1,
    title: 'Test Course',
    courseData: validCourseData,
    progressData: validProgressData,
    metadata: { some: 'data' }, // Unknown schema allows any object
    settings: { any: 'value' },
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02')
  };

  const result = Schema.decodeEither(schema)(completeData);
  expect(Either.isRight(result)).toBeTruthy();

  if (Either.isRight(result)) {
    expect(result.right.id).toBe(1);
    expect(result.right.title).toBe('Test Course');
    expect(result.right.courseData.difficulty).toBe('beginner');
    expect(result.right.progressData?.completionPercentage).toBe(50);
  }
});

test('select schema with refinements validates and decodes', () => {
  const schema = createSelectSchema(courseTable, {
    id: ({ id }) => id.pipe(Schema.positive()),
    courseData: CourseDataSchema
  });

  // Valid case - positive ID
  const validData = {
    id: 5,
    title: 'Test Course',
    courseData: validCourseData,
    progressData: null,
    metadata: {},
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const validResult = Schema.decodeEither(schema)(validData);
  expect(Either.isRight(validResult)).toBeTruthy();

  if (Either.isRight(validResult)) {
    expect(validResult.right.id).toBe(5);
  }

  // Invalid case - non-positive ID
  const invalidData = {
    ...validData,
    id: -1
  };

  const invalidResult = Schema.decodeUnknownEither(schema)(invalidData);
  expect(Either.isLeft(invalidResult)).toBeTruthy();
});

test('minimal valid data', () => {
  const schema = createInsertSchema(courseTable, {
    courseData: CourseDataSchema
  });

  const minimalCourse = {
    title: 'Test',
    courseData: {
      difficulty: 'beginner' as const,
      category: 'Test',
      tags: []
    }
  };

  const result = Schema.decodeEither(schema)(minimalCourse);
  expect(Either.isRight(result)).toBeTruthy();
});

test('optional fields can be omitted', () => {
  const schema = createInsertSchema(courseTable, {
    courseData: CourseDataSchema,
    progressData: ProgressDataSchema
  });

  const courseWithoutOptionals = {
    title: 'Test Course'
    // courseData, progressData omitted (optional in insert)
  };

  const result = Schema.decodeEither(schema)(courseWithoutOptionals);
  expect(Either.isRight(result)).toBeTruthy();
});

test('null values in nullable fields', () => {
  const schema = createInsertSchema(courseTable, {
    progressData: Schema.NullOr(ProgressDataSchema)
  });

  const courseWithNull = {
    title: 'Test Course',
    progressData: null // explicitly null
  };

  const result = Schema.decodeEither(schema)(courseWithNull);
  expect(Either.isRight(result)).toBeTruthy();
});

test('schema subset with pick', () => {
  const schema = createInsertSchema(courseTable, {
    courseData: CourseDataSchema,
    metadata: MetadataSchema
  }).pick('title', 'courseData');

  const result = Schema.decodeEither(schema)({
    title: 'Test Course',
    courseData: validCourseData
  });

  expect(Either.isRight(result)).toBeTruthy();
});


const TestTable = DrizzlePg.pgTable('myTable', {
  myVal: DrizzlePg.text('test'),
});

const testRefineTypeCoercionSchema = createInsertSchema(TestTable, {
  myVal: Schema.Number,
});

test('schema refine transforms number text to number at runtime', () => {
  const inputData = {
    myVal: 123 // This is a number
  };

  const result = Schema.decodeEither(testRefineTypeCoercionSchema)(inputData);

  expect(Either.isRight(result)).toBeTruthy();

  if (Either.isRight(result)) {
    // Verify that myVal is actually a number after decode
    expect(typeof result.right.myVal).toBe('number');
    expect(result.right.myVal).toBe(123);
  }
});
