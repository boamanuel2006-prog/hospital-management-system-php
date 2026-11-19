// In-memory store seeded from SQL File/hms.sql (no external database required)

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const VALID_STATUSES = ['Pending', 'Approved', 'Completed', 'Cancelled'];

function nowStr() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export const db = {
  admins: [
    {
      id: 1,
      username: 'admin',
      password: '$2y$10$Mf1nyZSTpNqfpf6.SkUwlukUlqshzTqfRnP0pX4XWR2pyjoL.sbSe',
      updationDate: '04-03-2024 11:42:05 AM'
    }
  ],

  users: [
    {
      id: 1,
      fullName: 'John Doe',
      address: 'A 123 ABC Apartment GZB 201017',
      city: 'Ghaziabad',
      gender: 'male',
      email: 'johndoe12@test.com',
      password: '$2y$10$2J0mUm83Va63L5fQ.i9Ekeuaat/EH2cRHPVheD8r3yGyeyssQdKIi',
      regDate: '2024-04-20 12:13:56',
      updationDate: '2026-06-15 16:24:54'
    },
    {
      id: 2,
      fullName: 'Amit kumar',
      address: 'new Delhi india',
      city: 'New Delhi',
      gender: 'male',
      email: 'amitk@gmail.com',
      password: 'f925916e2754e5e03f75dd58a5733251',
      regDate: '2024-04-21 13:15:32',
      updationDate: '2024-05-14 09:28:23'
    },
    {
      id: 3,
      fullName: 'John Karie',
      address: 'K-908, Kavi Apartment, Kanpur(Uttar Pradesh)',
      city: 'Kanpur',
      gender: 'male',
      email: 'john@gmail.com',
      password: '$2y$10$XzL2wJx1MRRlU32LYwEbce08uWvACAJ62fDfCBhfYLHR3Mnwqw5xS',
      regDate: '2026-06-18 06:33:15',
      updationDate: null
    },
    {
      id: 4,
      fullName: 'Amit',
      address: 'New Delhi',
      city: 'Delhi',
      gender: 'male',
      email: 'amit12@test.com',
      password: '$2y$10$TAFjLEAVIO4O/FPLbr288ePVb7rqaf89VqszIs4Q5goIaGOuL.22C',
      regDate: '2026-06-21 16:16:30',
      updationDate: null
    }
  ],

  doctors: [
    {
      id: 1,
      specilization: 'ENT',
      doctorName: 'Anuj kumar',
      address: 'A 123 XYZ Apartment Raj Nagar Ext Ghaziabad',
      docFees: '500',
      contactno: '142536250',
      docEmail: 'anujk123@test.com',
      password: '$2y$10$N9HN4tPs/lJZ.v/8BN0yxOiYJROLO7XsozsAdSJqREBNp2bLbtyXy',
      creationDate: '2024-04-10 18:16:52',
      updationDate: '2026-06-15 16:25:28'
    },
    {
      id: 2,
      specilization: 'Endocrinologists',
      doctorName: 'Charu Dua',
      address: 'X 1212 ABC Apartment Laxmi Nagar New Delhi',
      docFees: '800',
      contactno: '1231231230',
      docEmail: 'charudua12@test.com',
      password: 'f925916e2754e5e03f75dd58a5733251',
      creationDate: '2024-04-11 01:06:41',
      updationDate: '2024-05-14 09:26:28'
    },
    {
      id: 4,
      specilization: 'Pediatrics',
      doctorName: 'Priyanka Sinha',
      address: 'A 123 Xyz Aparmtnent Ghaziabad',
      docFees: '700',
      contactno: '74561235',
      docEmail: 'p12@t.com',
      password: 'f925916e2754e5e03f75dd58a5733251',
      creationDate: '2024-05-16 09:12:23',
      updationDate: null
    },
    {
      id: 5,
      specilization: 'Orthopedics',
      doctorName: 'Vipin Tayagi',
      address: 'Yasho Hospital New Delhi',
      docFees: '1200',
      contactno: '95214563210',
      docEmail: 'vpint123@gmail.com',
      password: 'f925916e2754e5e03f75dd58a5733251',
      creationDate: '2024-05-16 09:13:11',
      updationDate: null
    },
    {
      id: 6,
      specilization: 'Internal Medicine',
      doctorName: 'Dr Romil',
      address: 'Max Hospital Vaishali GZB',
      docFees: '1500',
      contactno: '8563214751',
      docEmail: 'drromil12@gmail.com',
      password: 'f925916e2754e5e03f75dd58a5733251',
      creationDate: '2024-05-16 09:14:11',
      updationDate: null
    },
    {
      id: 7,
      specilization: 'Obstetrics and Gynecology',
      doctorName: 'Bhavya rathore',
      address: 'Shop 12 Indira Puram Ghaziabad',
      docFees: '800',
      contactno: '745621330',
      docEmail: 'bhawya12@tt.com',
      password: 'f925916e2754e5e03f75dd58a5733251',
      creationDate: '2024-05-16 09:15:18',
      updationDate: null
    },
    {
      id: 8,
      specilization: 'Dental Care',
      doctorName: 'Pankaj Sharma',
      address: 'P-907, Navi Market\nKanpur Uttar Pradeah',
      docFees: '800',
      contactno: '2255647899',
      docEmail: 'pankaj@gmail.com',
      password: '$2y$10$P9bNKHNLlg/QJv9Jv6r42eaOOMen3Fzd5LoU.JGd4Ymy7pmhalsJK',
      creationDate: '2026-06-18 07:10:41',
      updationDate: null
    },
    {
      id: 9,
      specilization: 'Dental Care',
      doctorName: 'Garima Singh',
      address: 'Abc mayur Vihar new delhi',
      docFees: '500',
      contactno: '5264123032',
      docEmail: 'ga12@test.com',
      password: '$2y$10$wXLPRArKIuweC9fz1ibz0./zEC7v9bbbbaGdQdjv2VwQDPtkSBdky',
      creationDate: '2026-06-21 16:14:46',
      updationDate: '2026-06-21 16:19:38'
    }
  ],

  specializations: [
    { id: 1, specilization: 'Orthopedics', creationDate: '2024-04-09 18:09:46', updationDate: '2024-05-14 09:26:47' },
    { id: 2, specilization: 'Internal Medicine', creationDate: '2024-04-09 18:09:46', updationDate: '2024-05-14 09:26:56' },
    { id: 3, specilization: 'Obstetrics and Gynecology', creationDate: '2024-04-09 18:09:46', updationDate: '2024-05-14 09:26:56' },
    { id: 4, specilization: 'Dermatology', creationDate: '2024-04-09 18:09:46', updationDate: '2024-05-14 09:26:56' },
    { id: 5, specilization: 'Pediatrics', creationDate: '2024-04-09 18:09:46', updationDate: '2024-05-14 09:26:56' },
    { id: 6, specilization: 'Radiology', creationDate: '2024-04-09 18:09:46', updationDate: '2024-05-14 09:26:56' },
    { id: 7, specilization: 'General Surgery', creationDate: '2024-04-09 18:09:46', updationDate: '2024-05-14 09:26:56' },
    { id: 8, specilization: 'Ophthalmology', creationDate: '2024-04-09 18:09:46', updationDate: '2024-05-14 09:26:56' },
    { id: 9, specilization: 'Anesthesia', creationDate: '2024-04-09 18:09:46', updationDate: '2024-05-14 09:26:56' },
    { id: 10, specilization: 'Pathology', creationDate: '2024-04-09 18:09:46', updationDate: '2024-05-14 09:26:56' },
    { id: 11, specilization: 'ENT', creationDate: '2024-04-09 18:09:46', updationDate: '2024-05-14 09:26:56' },
    { id: 12, specilization: 'Dental Care', creationDate: '2024-04-09 18:09:46', updationDate: '2024-05-14 09:26:56' },
    { id: 13, specilization: 'Dermatologists', creationDate: '2024-04-09 18:09:46', updationDate: '2024-05-14 09:26:56' },
    { id: 14, specilization: 'Endocrinologists', creationDate: '2024-04-09 18:09:46', updationDate: '2024-05-14 09:26:56' },
    { id: 15, specilization: 'Neurologists', creationDate: '2024-04-09 18:09:46', updationDate: '2024-05-14 09:26:56' }
  ],

  doctorAvailability: [
    { id: 1, doctor_id: 1, day_of_week: 1, available_date: '2026-06-20', start_time: '11:10:00', end_time: '14:30:00', slot_duration_minutes: 10, max_appointments: 50, is_active: 1, created_at: '2026-06-15 22:09:38' },
    { id: 2, doctor_id: 1, day_of_week: 2, available_date: '2026-06-16', start_time: '09:00:00', end_time: '12:00:00', slot_duration_minutes: 30, max_appointments: 3, is_active: 1, created_at: '2026-06-15 22:14:59' },
    { id: 3, doctor_id: 8, day_of_week: 0, available_date: '2026-06-20', start_time: '09:30:00', end_time: '18:30:00', slot_duration_minutes: 30, max_appointments: 10, is_active: 1, created_at: '2026-06-18 12:42:32' },
    { id: 4, doctor_id: 9, day_of_week: 1, available_date: '2026-06-22', start_time: '10:30:00', end_time: '12:50:00', slot_duration_minutes: 25, max_appointments: 10, is_active: 1, created_at: '2026-06-21 21:45:41' }
  ],

  appointments: [
    { id: 1, doctorSpecialization: 'ENT', doctorId: 1, userId: 1, consultancyFees: 500, appointmentDate: '2024-05-30', appointmentTime: '9:15 AM', postingDate: '2024-05-15 03:42:11', userStatus: 1, doctorStatus: 1, status: 'Completed', status_updated_at: '2026-06-15 22:07:28', status_updated_by: 'doctor:1', reschedule_reason: null, cancel_reason: null },
    { id: 2, doctorSpecialization: 'Endocrinologists', doctorId: 2, userId: 2, consultancyFees: 800, appointmentDate: '2024-05-31', appointmentTime: '2:45 PM', postingDate: '2024-05-16 09:08:54', userStatus: 1, doctorStatus: 0, status: 'Cancelled', status_updated_at: '2026-06-15 22:30:32', status_updated_by: 'admin:1', reschedule_reason: null, cancel_reason: null },
    { id: 3, doctorSpecialization: 'ENT', doctorId: 1, userId: 1, consultancyFees: 500, appointmentDate: '2026-06-16', appointmentTime: '10:30:00', postingDate: '2026-06-15 16:44:59', userStatus: 1, doctorStatus: 1, status: 'Completed', status_updated_at: '2026-06-15 22:14:59', status_updated_by: 'doctor:1', reschedule_reason: null, cancel_reason: null },
    { id: 4, doctorSpecialization: 'Dental Care', doctorId: 8, userId: 3, consultancyFees: 800, appointmentDate: '2026-06-20', appointmentTime: '11:42:00', postingDate: '2026-06-18 07:13:11', userStatus: 1, doctorStatus: 1, status: 'Completed', status_updated_at: '2026-06-18 13:02:15', status_updated_by: 'doctor:8', reschedule_reason: null, cancel_reason: null },
    { id: 5, doctorSpecialization: 'Dental Care', doctorId: 9, userId: 4, consultancyFees: 500, appointmentDate: '2026-06-22', appointmentTime: '11:50:00', postingDate: '2026-06-21 16:17:00', userStatus: 1, doctorStatus: 1, status: 'Completed', status_updated_at: '2026-06-21 21:47:50', status_updated_by: 'doctor:9', reschedule_reason: null, cancel_reason: null }
  ],

  prescriptions: [
    { id: 1, appointment_id: 1, doctor_id: 1, patient_user_id: 1, diagnosis: 'Fever', treatment: 'Take Reset', medicines: 'Dolo 600 Mg', notes: 'NA', followup_date: '2026-06-30', created_at: '2026-06-15 22:06:25', updated_at: '2026-06-15 22:07:28' },
    { id: 3, appointment_id: 3, doctor_id: 1, patient_user_id: 1, diagnosis: 'Workflow verification diagnosis', treatment: 'Workflow verification treatment', medicines: 'Workflow verification medicine', notes: 'Created during completion check', followup_date: '2026-06-22', created_at: '2026-06-15 22:14:59', updated_at: '2026-06-15 22:14:59' },
    { id: 4, appointment_id: 4, doctor_id: 8, patient_user_id: 3, diagnosis: 'Have sensitivity in teeth', treatment: 'A cleaning session must be taken twice in month', medicines: 'Vinarge Tooth Paste and Mouth Gargle', notes: 'Not take carbonated drinks', followup_date: '2026-06-27', created_at: '2026-06-18 13:02:15', updated_at: '2026-06-18 13:02:15' },
    { id: 5, appointment_id: 5, doctor_id: 9, patient_user_id: 4, diagnosis: 'RCT', treatment: 'RCT in two teeths', medicines: 'RX Tab 1, Tab2', notes: 'NA', followup_date: '2026-06-26', created_at: '2026-06-21 21:47:50', updated_at: '2026-06-21 21:47:50' }
  ],

  patients: [
    { ID: 1, Docid: 1, PatientName: 'Rahul Singyh', PatientContno: '452463210', PatientEmail: 'rahul12@gmail.com', PatientGender: 'male', PatientAdd: 'NA', PatientAge: 32, PatientMedhis: 'Fever, Cold', CreationDate: '2024-05-16 05:23:35', UpdationDate: null },
    { ID: 2, Docid: 1, PatientName: 'Amit', PatientContno: '4545454545', PatientEmail: 'amitk@gmail.com', PatientGender: 'male', PatientAdd: 'NA', PatientAge: 45, PatientMedhis: 'Fever', CreationDate: '2024-05-16 09:01:26', UpdationDate: null },
    { ID: 3, Docid: 8, PatientName: 'Seema Nair', PatientContno: '1562368974', PatientEmail: 'seema@gmail.com', PatientGender: 'Female', PatientAdd: 'G-809, Kamal Apartment Hari Nagar', PatientAge: 38, PatientMedhis: 'Not Yet', CreationDate: '2026-06-18 07:34:16', UpdationDate: null }
  ],

  medicalHistory: [
    { ID: 1, PatientID: 2, BloodPressure: '80/120', BloodSugar: '110', Weight: '85', Temperature: '97', MedicalPres: 'Dolo,\nLevocit 5mg', CreationDate: '2024-05-16 09:07:16' },
    { ID: 2, PatientID: 3, BloodPressure: '101/60', BloodSugar: '110/120', Weight: '52', Temperature: '98', MedicalPres: 'uyuikhkjhjkgh', CreationDate: '2026-06-18 08:01:20' }
  ],

  contactQueries: [
    { id: 1, fullname: 'Anuj kumar', email: 'anujk30@test.com', contactno: '1425362514', message: 'This is for testing purposes. Please contact me regarding ENT consultation availability.', PostingDate: '2024-04-20 16:52:03', AdminRemark: null, LastupdationDate: '2024-05-14 09:27:15', IsRead: null },
    { id: 2, fullname: 'Anuj kumar', email: 'ak@gmail.com', contactno: '1111122233', message: 'This is for testing', PostingDate: '2024-04-23 13:13:41', AdminRemark: 'Contact the patient', LastupdationDate: '2024-04-27 13:13:57', IsRead: 1 }
  ],

  pages: [
    {
      ID: 1,
      PageType: 'aboutus',
      PageTitle: 'About Us',
      PageDescription: 'The Hospital Management System (HMS) is designed to streamline patient information, doctor scheduling, appointment workflows, prescriptions, and clinical records in an efficient, organized manner. It standardizes data across patient, doctor, and administrative portals to improve coordination and care delivery.',
      Email: null,
      MobileNumber: null,
      UpdationDate: '2020-05-20 07:21:52',
      OpenningTime: null
    },
    {
      ID: 2,
      PageType: 'contactus',
      PageTitle: 'Contact Details',
      PageDescription: 'D-204, Hole Town South West, Delhi-110096, India',
      Email: 'info@gmail.com',
      MobileNumber: '1122334455',
      UpdationDate: '2020-05-20 07:24:07',
      OpenningTime: '9 am To 8 Pm'
    }
  ],

  notifications: [
    { id: 1, user_type: 'patient', user_id: 1, title: 'Prescription available', message: 'Your prescription for appointment #1 is ready to download.', is_read: 0, created_at: '2026-06-15 22:06:25', read_at: null },
    { id: 2, user_type: 'patient', user_id: 1, title: 'Appointment status updated', message: 'Your appointment is now Completed.', is_read: 0, created_at: '2026-06-15 22:06:51', read_at: null },
    { id: 3, user_type: 'admin', user_id: null, title: 'Appointment status updated', message: 'Doctor updated appointment #1 to Completed.', is_read: 1, created_at: '2026-06-15 22:06:51', read_at: '2026-06-21 21:49:01' },
    { id: 6, user_type: 'patient', user_id: 2, title: 'Appointment status updated', message: 'Your appointment is now Cancelled.', is_read: 0, created_at: '2026-06-15 22:30:32', read_at: null },
    { id: 8, user_type: 'admin', user_id: null, title: 'New appointment request', message: 'A patient booked appointment #4.', is_read: 1, created_at: '2026-06-18 12:43:11', read_at: '2026-06-21 21:49:01' },
    { id: 9, user_type: 'doctor', user_id: 8, title: 'New appointment request', message: 'A patient booked appointment #4.', is_read: 0, created_at: '2026-06-18 12:43:11', read_at: null },
    { id: 12, user_type: 'patient', user_id: 3, title: 'Prescription available', message: 'Your prescription for appointment #4 is ready to download.', is_read: 0, created_at: '2026-06-18 13:02:15', read_at: null },
    { id: 14, user_type: 'doctor', user_id: 9, title: 'New appointment request', message: 'A patient booked appointment #5.', is_read: 0, created_at: '2026-06-21 21:47:00', read_at: null }
  ],

  auditLogs: [
    { id: 1, actor_type: 'doctor', actor_id: 1, action: 'appointment_status_changed', entity_type: 'appointment', entity_id: 1, details: 'Status changed to Completed', ip_address: '127.0.0.1', created_at: '2026-06-15 22:06:25' },
    { id: 2, actor_type: 'doctor', actor_id: 1, action: 'prescription_saved', entity_type: 'appointment', entity_id: 1, details: 'Prescription saved for John Doe', ip_address: '127.0.0.1', created_at: '2026-06-15 22:06:25' },
    { id: 6, actor_type: 'doctor', actor_id: 1, action: 'availability_created', entity_type: 'doctor_availability', entity_id: 1, details: 'Created availability slot.', ip_address: '127.0.0.1', created_at: '2026-06-15 22:09:38' },
    { id: 11, actor_type: 'admin', actor_id: 1, action: 'appointment_status_changed', entity_type: 'appointment', entity_id: 2, details: 'Status changed to Cancelled', ip_address: '127.0.0.1', created_at: '2026-06-15 22:30:32' },
    { id: 15, actor_type: 'admin', actor_id: 1, action: 'doctor_created', entity_type: 'doctors', entity_id: 8, details: 'Doctor created: Pankaj Sharma', ip_address: '127.0.0.1', created_at: '2026-06-18 12:40:41' },
    { id: 17, actor_type: 'patient', actor_id: 3, action: 'appointment_created', entity_type: 'appointment', entity_id: 4, details: 'Booked with Dr. Pankaj Sharma', ip_address: '127.0.0.1', created_at: '2026-06-18 12:43:11' },
    { id: 21, actor_type: 'doctor', actor_id: 8, action: 'patient_created', entity_type: 'tblpatient', entity_id: 3, details: 'Patient created: Seema Nair', ip_address: '127.0.0.1', created_at: '2026-06-18 13:04:16' },
    { id: 23, actor_type: 'admin', actor_id: 1, action: 'medical_history_added', entity_type: 'tblpatient', entity_id: 3, details: 'Admin added medical history.', ip_address: '127.0.0.1', created_at: '2026-06-18 13:31:20' },
    { id: 28, actor_type: 'admin', actor_id: 1, action: 'doctor_created', entity_type: 'doctors', entity_id: 9, details: 'Doctor created: Garima Singh', ip_address: '127.0.0.1', created_at: '2026-06-21 21:44:46' },
    { id: 30, actor_type: 'patient', actor_id: 4, action: 'appointment_created', entity_type: 'appointment', entity_id: 5, details: 'Booked with Dr. Garima Singh', ip_address: '127.0.0.1', created_at: '2026-06-21 21:47:00' },
    { id: 33, actor_type: 'doctor', actor_id: 9, action: 'prescription_saved', entity_type: 'appointment', entity_id: 5, details: 'Prescription saved for Amit', ip_address: '127.0.0.1', created_at: '2026-06-21 21:47:50' }
  ],

  userLogs: [
    { id: 1, uid: 1, username: 'johndoe12@test.com', userip: '127.0.0.1', loginTime: '2024-05-15 03:41:48', logout: null, status: 1 },
    { id: 2, uid: 2, username: 'amitk@gmail.com', userip: '127.0.0.1', loginTime: '2024-05-16 09:08:06', logout: '16-05-2024 02:41:06 PM', status: 1 },
    { id: 7, uid: 3, username: 'john@gmail.com', userip: '127.0.0.1', loginTime: '2026-06-18 06:41:51', logout: '18-06-2026 12:46:02 PM', status: 1 },
    { id: 8, uid: 4, username: 'amit12@test.com', userip: '127.0.0.1', loginTime: '2026-06-21 16:16:37', logout: '21-06-2026 09:50:04 PM', status: 1 }
  ],

  doctorLogs: [
    { id: 1, uid: 1, username: 'anujk123@test.com', userip: '127.0.0.1', loginTime: '2024-05-16 05:19:33', logout: null, status: 1 },
    { id: 6, uid: 8, username: 'pankaj@gmail.com', userip: '127.0.0.1', loginTime: '2026-06-18 07:16:50', logout: '18-06-2026 01:09:38 PM', status: 1 },
    { id: 7, uid: 9, username: 'ga12@test.com', userip: '127.0.0.1', loginTime: '2026-06-21 16:14:57', logout: '21-06-2026 09:49:45 PM', status: 1 }
  ]
};

const counters = {
  users: 5,
  doctors: 10,
  specializations: 18,
  doctorAvailability: 5,
  appointments: 6,
  prescriptions: 6,
  patients: 4,
  medicalHistory: 3,
  contactQueries: 3,
  notifications: 18,
  auditLogs: 34,
  userLogs: 9,
  doctorLogs: 8
};

export function nextId(collection) {
  counters[collection] = (counters[collection] || 1) + 1;
  return counters[collection];
}

export function getDays() {
  return DAYS;
}

export function isValidStatus(status) {
  return VALID_STATUSES.includes(status);
}

export function normalizeTime(timeStr) {
  if (!timeStr) return '';
  const trimmed = String(timeStr).trim();
  if (/^\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  return trimmed;
}

export function getAvailabilitySummary(doctorId) {
  const slots = db.doctorAvailability.filter(
    (s) => Number(s.doctor_id) === Number(doctorId) && Number(s.is_active) === 1
  );
  if (!slots.length) return 'Flexible schedule (no fixed slots restricted).';
  return slots
    .map((s) => `${s.available_date || DAYS[s.day_of_week]} ${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)}`)
    .join('; ');
}

export function checkDoctorAvailability(doctorId, appDate, appTime, excludeAppointmentId = null) {
  if (!appDate || !appTime) {
    return { ok: false, reason: 'Please choose a valid appointment date and time.' };
  }
  const normalizedTime = normalizeTime(appTime);
  const conflict = db.appointments.find(
    (a) =>
      Number(a.doctorId) === Number(doctorId) &&
      a.appointmentDate === appDate &&
      normalizeTime(a.appointmentTime) === normalizedTime &&
      a.status !== 'Cancelled' &&
      Number(a.id) !== Number(excludeAppointmentId || 0)
  );
  if (conflict) {
    return { ok: false, reason: 'This doctor already has an appointment at the selected date and time.' };
  }

  const activeSlots = db.doctorAvailability.filter(
    (s) => Number(s.doctor_id) === Number(doctorId) && Number(s.is_active) === 1
  );
  if (activeSlots.length > 0) {
    const dayOfWeek = new Date(`${appDate}T00:00:00`).getDay();
    const matchingSlots = activeSlots.filter(
      (s) => (s.available_date ? s.available_date === appDate : Number(s.day_of_week) === dayOfWeek)
    );
    if (matchingSlots.length > 0) {
      const inWindow = matchingSlots.some(
        (s) => normalizedTime >= s.start_time && normalizedTime <= s.end_time
      );
      if (!inWindow) {
        return {
          ok: false,
          reason: `Selected time is outside the doctor's available hours (${getAvailabilitySummary(doctorId)}).`
        };
      }
    }
  }
  return { ok: true, reason: '' };
}

export function logAudit(actorType, actorId, action, entityType, entityId, details = '', ip = '127.0.0.1') {
  db.auditLogs.unshift({
    id: nextId('auditLogs'),
    actor_type: actorType,
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
    ip_address: ip,
    created_at: nowStr()
  });
}

export function notify(userType, userId, title, message) {
  db.notifications.unshift({
    id: nextId('notifications'),
    user_type: userType,
    user_id: userId,
    title,
    message,
    is_read: 0,
    created_at: nowStr(),
    read_at: null
  });
}

export function setAppointmentStatus(appointmentId, status, actorType, actorId) {
  if (!isValidStatus(status)) return false;
  const appt = db.appointments.find((a) => Number(a.id) === Number(appointmentId));
  if (!appt) return false;
  appt.status = status;
  appt.status_updated_at = nowStr();
  appt.status_updated_by = `${actorType}:${actorId}`;
  if (status === 'Cancelled') {
    if (actorType === 'patient') appt.userStatus = 0;
    else appt.doctorStatus = 0;
  } else {
    appt.userStatus = 1;
    appt.doctorStatus = 1;
  }
  logAudit(actorType, actorId, 'appointment_status_changed', 'appointment', appt.id, `Status changed to ${status}`);
  return true;
}

export { nowStr, todayStr, DAYS, VALID_STATUSES };
