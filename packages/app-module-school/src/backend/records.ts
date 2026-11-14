import type { Store } from './store';
import type { Classroom, Course, StudentClass, Teacher } from './types';

// Typed lists of the stored records (the store only knows loose records).
export const listTeachers = (store: Store): Teacher[] => store.collection('teachers').list() as unknown as Teacher[];

export const listStudentClasses = (store: Store): StudentClass[] =>
  store.collection('classes').list() as unknown as StudentClass[];

export const listCourses = (store: Store): Course[] => store.collection('courses').list() as unknown as Course[];

export const listClassrooms = (store: Store): Classroom[] =>
  store.collection('classrooms').list() as unknown as Classroom[];
