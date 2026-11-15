import { readFileSync } from 'node:fs';
// Paths are relative to the package root, where vitest runs.
import { describe, expect, it } from 'vitest';

const read = (name: string): string => readFileSync(name, 'utf8');

describe('teachers page', () => {
  it('is listed in the navigation', () => {
    const manifest = JSON.parse(read('manifest.json')) as {
      extensionPoints: { slot: string; label: string; view: { value: string } }[];
    };
    const entry = manifest.extensionPoints.find((e) => e.slot === 'nav' && e.label === 'Teachers');
    expect(entry?.view.value).toBe('./src/dsl-views/teachers.yaml');
  });

  it('lists, creates, edits and deletes teachers', () => {
    const view = read('src/dsl-views/teachers.yaml');
    expect(view).toContain('GET /api/modules/school/teachers');
    expect(view).toContain('POST /api/modules/school/teachers');
    expect(view).toContain('PUT /api/modules/school/teachers/{id}');
    expect(view).toContain('DELETE /api/modules/school/teachers/{id}');
    expect(view).toContain('confirm: Delete this teacher?');
  });

  it('is no longer on the home page, which keeps the counters', () => {
    const home = read('src/dsl-views/page.yaml');
    expect(home).not.toMatch(/teachers\//i);
    expect(home).not.toContain('Form');
    expect(home).not.toContain('DataTable');
    expect(home).toContain('$sources.summary.teachers');
    expect(home.match(/StatTile/g)).toHaveLength(4);
  });
});

describe('courses page', () => {
  it('chooses the subject among the subjects of the selected teacher', () => {
    const view = read('src/dsl-views/courses.yaml');
    expect(view).toContain('GET /api/modules/school/subject-options/{teacherId}');
    expect(view).not.toContain('FieldText');
    expect(view.match(/bind: subject, label: Subject, options: \$sources\.subjectOptions/g)).toHaveLength(2);
  });
});

describe('home page and id columns', () => {
  it('shows no skeleton text on the home page', () => {
    const page = read('src/dsl-views/page.yaml');
    expect(page).not.toContain('ping');
    expect(page).not.toContain('Badge');
    expect(page).toContain('$sources.summary.classrooms');
  });

  it.each(['classrooms', 'student-classes'])('shows no id column in %s', (name) => {
    const view = read(`src/dsl-views/${name}.yaml`);
    expect(view).not.toMatch(/field: id\b/);
    expect(view).toContain('{id}');
  });
});

describe('schedule page', () => {
  it('filters the grid and the entries by student class', () => {
    const view = read('src/dsl-views/schedule.yaml');
    expect(view).toContain('GET /api/modules/school/schedule-class-options');
    expect(view).toContain('bind: studentClassId');
    expect(view).toContain('schedule-grid?studentClassId={studentClassId}');
    expect(view).toContain('schedule-entries?studentClassId={studentClassId}');
    expect(view.match(/dependsOn: studentClassId/g)).toHaveLength(2);
    expect(view.match(/reloadSources: \[grid, entries\]/g)).toHaveLength(3);
  });
});
