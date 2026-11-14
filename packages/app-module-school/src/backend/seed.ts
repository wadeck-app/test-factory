import type { Store } from './store';

// Sample data with fixed ids so the records can reference each other.
export const SAMPLE_CLASSROOMS = [
  { id: 'r1', name: 'A101', building: 'Main building', capacity: 30 },
  { id: 'r2', name: 'A102', building: 'Main building', capacity: 30 },
  { id: 'r3', name: 'B201', building: 'North wing', capacity: 25 },
  { id: 'r4', name: 'B202', building: 'North wing', capacity: 25 },
  { id: 'r5', name: 'Science lab', building: 'Science center', capacity: 35 },
  { id: 'r6', name: 'Art studio', building: 'Arts pavilion', capacity: 20 },
];

export const SAMPLE_STUDENT_CLASSES = [
  { id: 'k1', name: '6A', level: 'Grade 6', studentCount: 24 },
  { id: 'k2', name: '5B', level: 'Grade 7', studentCount: 26 },
  { id: 'k3', name: '4C', level: 'Grade 8', studentCount: 22 },
  { id: 'k4', name: '3D', level: 'Grade 9', studentCount: 28 },
];

export const SAMPLE_TEACHERS = [
  { id: 't1', name: 'Alice Martin', subjects: ['Mathematics', 'Physics'] },
  { id: 't2', name: 'Bruno Lefevre', subjects: ['French', 'Latin'] },
  { id: 't3', name: 'Chloe Bernard', subjects: ['English', 'German'] },
  { id: 't4', name: 'David Petit', subjects: ['Biology', 'Chemistry'] },
  { id: 't5', name: 'Emma Rousseau', subjects: ['History', 'Geography'] },
  { id: 't6', name: 'Farid Haddad', subjects: ['Physics', 'Mathematics'] },
  { id: 't7', name: 'Gaelle Moreau', subjects: ['Art', 'Music'] },
  { id: 't8', name: 'Hugo Girard', subjects: ['Physical education', 'Technology'] },
];

export const SAMPLE_COURSES = [
  { id: 'c1', subject: 'Mathematics', teacherId: 't1', studentClassId: 'k1' },
  { id: 'c2', subject: 'French', teacherId: 't2', studentClassId: 'k1' },
  { id: 'c3', subject: 'English', teacherId: 't3', studentClassId: 'k1' },
  { id: 'c4', subject: 'Biology', teacherId: 't4', studentClassId: 'k2' },
  { id: 'c5', subject: 'History', teacherId: 't5', studentClassId: 'k2' },
  { id: 'c6', subject: 'Physics', teacherId: 't6', studentClassId: 'k2' },
  { id: 'c7', subject: 'Mathematics', teacherId: 't6', studentClassId: 'k3' },
  { id: 'c8', subject: 'Art', teacherId: 't7', studentClassId: 'k3' },
  { id: 'c9', subject: 'Geography', teacherId: 't5', studentClassId: 'k3' },
  { id: 'c10', subject: 'Physical education', teacherId: 't8', studentClassId: 'k4' },
  { id: 'c11', subject: 'Chemistry', teacherId: 't4', studentClassId: 'k4' },
  { id: 'c12', subject: 'Music', teacherId: 't7', studentClassId: 'k4' },
];

// [courseId, classroomId, day, slot]
const SAMPLE_SESSIONS: [string, string, string, string][] = [
  ['c1', 'r1', 'mon', '08:00-09:00'],
  ['c2', 'r2', 'mon', '11:00-12:00'],
  ['c3', 'r3', 'tue', '10:00-11:00'],
  ['c4', 'r5', 'wed', '09:00-10:00'],
  ['c5', 'r5', 'thu', '08:00-09:00'],
  ['c6', 'r1', 'thu', '11:00-12:00'],
  ['c7', 'r1', 'fri', '10:00-11:00'],
  ['c8', 'r2', 'mon', '09:00-10:00'],
  ['c9', 'r3', 'tue', '08:00-09:00'],
  ['c10', 'r5', 'tue', '11:00-12:00'],
  ['c11', 'r5', 'wed', '10:00-11:00'],
  ['c12', 'r1', 'thu', '09:00-10:00'],
  ['c1', 'r1', 'tue', '11:00-12:00'],
  ['c2', 'r2', 'wed', '10:00-11:00'],
  ['c3', 'r3', 'thu', '09:00-10:00'],
  ['c4', 'r5', 'fri', '08:00-09:00'],
  ['c5', 'r5', 'fri', '11:00-12:00'],
  ['c6', 'r1', 'mon', '10:00-11:00'],
  ['c7', 'r1', 'tue', '09:00-10:00'],
  ['c8', 'r2', 'wed', '08:00-09:00'],
  ['c9', 'r3', 'wed', '11:00-12:00'],
  ['c10', 'r5', 'thu', '10:00-11:00'],
  ['c11', 'r5', 'fri', '09:00-10:00'],
  ['c12', 'r2', 'mon', '08:00-09:00'],
];

export const SAMPLE_SLOTS = SAMPLE_SESSIONS.map(([courseId, classroomId, day, slot], i) => ({
  id: `s${i + 1}`,
  courseId,
  classroomId,
  day,
  slot,
}));

// Writes the sample data on the first start: when the five collections are empty and it was never done before.
export function seedIfEmpty(store: Store): boolean {
  const data = {
    classrooms: SAMPLE_CLASSROOMS,
    classes: SAMPLE_STUDENT_CLASSES,
    teachers: SAMPLE_TEACHERS,
    courses: SAMPLE_COURSES,
    slots: SAMPLE_SLOTS,
  };
  const names = Object.keys(data) as (keyof typeof data)[];
  if (store.isSeeded() || names.some((name) => store.collection(name).list().length > 0)) {
    return false;
  }
  for (const name of names) {
    for (const record of data[name]) {
      store.collection(name).insert(record);
    }
  }
  store.markSeeded();
  return true;
}
