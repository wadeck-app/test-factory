// Entity types of the school module, defined once and shared by the route files.
export interface Classroom {
  id: string;
  name: string;
  capacity: number;
  building: string;
}
export type ClassroomInput = Omit<Classroom, 'id'>;

export interface Teacher {
  id: string;
  name: string;
  subjects: string[];
}
export type TeacherInput = Omit<Teacher, 'id'>;

export interface StudentClass {
  id: string;
  name: string;
  level: string;
  studentCount: number;
}
export type StudentClassInput = Omit<StudentClass, 'id'>;

export interface Course {
  id: string;
  subject: string;
  teacherId: string;
  studentClassId: string;
}
export type CourseInput = Omit<Course, 'id'>;
