import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  db,
  nextId,
  nowStr,
  todayStr,
  DAYS,
  VALID_STATUSES,
  isValidStatus,
  normalizeTime,
  getAvailabilitySummary,
  checkDoctorAvailability,
  logAudit,
  notify,
  setAppointmentStatus
} from './src/store.js';
import { passwordMatches, hashPassword, flash, consumeFlashes, requireRole, statusBadge } from './src/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'hms-dev-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' }
  })
);
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.locals.flashes = consumeFlashes(req);
  res.locals.currentUserName = req.session?.userName || '';
  res.locals.statusBadge = statusBadge;
  res.locals.today = todayStr();
  next();
});

// Helper joins
function enrichAppointment(a) {
  const doctor = db.doctors.find((d) => Number(d.id) === Number(a.doctorId));
  const user = db.users.find((u) => Number(u.id) === Number(a.userId));
  const rx = db.prescriptions.find((p) => Number(p.appointment_id) === Number(a.id));
  return {
    ...a,
    doctorName: doctor ? doctor.doctorName : 'Unknown Doctor',
    fullName: user ? user.fullName : 'Unknown Patient',
    email: user ? user.email : '',
    prescriptionId: rx ? rx.id : null,
    availabilitySummary: getAvailabilitySummary(a.doctorId)
  };
}

// ---------- Public Routes ----------
app.get(['/', '/index.php', '/hospital', '/hospital/index.php'], (req, res) => {
  const aboutPage = db.pages.find((p) => p.PageType === 'aboutus');
  const contactPage = db.pages.find((p) => p.PageType === 'contactus');
  res.render('home', {
    specializations: db.specializations,
    aboutPage,
    contactPage,
    contactSubmitted: req.query.contact === 'ok'
  });
});

app.post('/contact', (req, res) => {
  const fullname = String(req.body.fullname || '').trim();
  const email = String(req.body.emailid || '').trim();
  const contactno = String(req.body.mobileno || '').trim();
  const message = String(req.body.description || '').trim();
  if (fullname && email && message) {
    const id = nextId('contactQueries');
    db.contactQueries.unshift({
      id,
      fullname,
      email,
      contactno,
      message,
      PostingDate: nowStr(),
      AdminRemark: null,
      LastupdationDate: null,
      IsRead: null
    });
    notify('admin', null, 'New contact query', `${fullname} sent a contact inquiry (#${id}).`);
  }
  res.redirect('/?contact=ok#contact');
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', runtime: 'node', storage: 'in-memory' });
});

// ---------- Patient Portal ----------
app.get(['/hms', '/hms/', '/hms/user-login.php', '/hms/login'], (req, res) => {
  if (req.session?.role === 'patient') return res.redirect('/hms/dashboard.php');
  res.render('patient/login');
});

app.post('/hms/user-login.php', (req, res) => {
  const email = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  const ip = req.ip || '127.0.0.1';

  if (user && passwordMatches(password, user.password)) {
    if (!String(user.password).startsWith('$2')) {
      user.password = hashPassword(password);
    }
    req.session.userId = user.id;
    req.session.role = 'patient';
    req.session.userName = user.fullName;
    req.session.userEmail = user.email;
    db.userLogs.unshift({
      id: nextId('userLogs'),
      uid: user.id,
      username: email,
      userip: ip,
      loginTime: nowStr(),
      logout: null,
      status: 1
    });
    return res.redirect('/hms/dashboard.php');
  }
  db.userLogs.unshift({
    id: nextId('userLogs'),
    uid: null,
    username: email,
    userip: ip,
    loginTime: nowStr(),
    logout: null,
    status: 0
  });
  flash(req, 'danger', 'Invalid email or password.');
  res.redirect('/hms/user-login.php');
});

app.get('/hms/registration.php', (req, res) => {
  res.render('patient/register');
});

app.post('/hms/registration.php', (req, res) => {
  const fullName = String(req.body.full_name || '').trim();
  const address = String(req.body.address || '').trim();
  const city = String(req.body.city || '').trim();
  const gender = String(req.body.gender || 'male').trim();
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '');
  const confirm = String(req.body.password_again || '');

  if (!fullName || !email || password.length < 6 || password !== confirm) {
    flash(req, 'danger', 'Please complete all fields and ensure passwords match (min 6 chars).');
    return res.redirect('/hms/registration.php');
  }
  if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    flash(req, 'danger', 'This email is already registered.');
    return res.redirect('/hms/registration.php');
  }
  const id = nextId('users');
  db.users.push({
    id,
    fullName,
    address,
    city,
    gender,
    email,
    password: hashPassword(password),
    regDate: nowStr(),
    updationDate: null
  });
  flash(req, 'success', 'Account created! You can now log in.');
  res.redirect('/hms/user-login.php');
});

app.get('/hms/dashboard.php', requireRole('patient', '/hms/user-login.php'), (req, res) => {
  const userId = req.session.userId;
  const mine = db.appointments.filter((a) => Number(a.userId) === Number(userId)).map(enrichAppointment);
  const myPatients = db.patients.filter(
    (p) => String(p.PatientEmail || '').toLowerCase() === String(req.session.userEmail || '').toLowerCase()
  );
  const myRx = db.prescriptions.filter((p) => Number(p.patient_user_id) === Number(userId));
  const nextAppointment =
    mine
      .filter((a) => a.appointmentDate >= todayStr() && a.status !== 'Cancelled')
      .sort((a, b) => a.appointmentDate.localeCompare(b.appointmentDate))[0] || null;

  res.render('patient/dashboard', {
    stats: {
      appointments: mine.length,
      pending: mine.filter((a) => a.status === 'Pending').length,
      completed: mine.filter((a) => a.status === 'Completed').length,
      history: myPatients.length,
      prescriptions: myRx.length
    },
    nextAppointment,
    recentAppointments: mine.slice().sort((a, b) => b.id - a.id).slice(0, 5)
  });
});

app.get('/hms/book-appointment.php', requireRole('patient', '/hms/user-login.php'), (req, res) => {
  const doctors = db.doctors
    .slice()
    .sort((a, b) => a.doctorName.localeCompare(b.doctorName))
    .map((d) => ({ ...d, availabilitySummary: getAvailabilitySummary(d.id) }));
  res.render('patient/book-appointment', {
    specialties: db.specializations.slice().sort((a, b) => a.specilization.localeCompare(b.specilization)),
    doctors
  });
});

app.post('/hms/book-appointment.php', requireRole('patient', '/hms/user-login.php'), (req, res) => {
  const userId = req.session.userId;
  const doctorId = Number(req.body.doctor);
  const appDate = String(req.body.appdate || '').trim();
  const appTime = normalizeTime(req.body.apptime);
  const doctor = db.doctors.find((d) => Number(d.id) === doctorId);

  if (!doctor) {
    flash(req, 'danger', 'Please select a valid doctor.');
    return res.redirect('/hms/book-appointment.php');
  }
  const avail = checkDoctorAvailability(doctorId, appDate, appTime);
  if (!avail.ok) {
    flash(req, 'danger', avail.reason);
    return res.redirect('/hms/book-appointment.php');
  }

  const appointmentId = nextId('appointments');
  db.appointments.push({
    id: appointmentId,
    doctorSpecialization: doctor.specilization,
    doctorId: doctor.id,
    userId,
    consultancyFees: Number(doctor.docFees),
    appointmentDate: appDate,
    appointmentTime: appTime,
    postingDate: nowStr(),
    userStatus: 1,
    doctorStatus: 1,
    status: 'Pending',
    status_updated_at: nowStr(),
    status_updated_by: `patient:${userId}`,
    reschedule_reason: null,
    cancel_reason: null
  });
  logAudit('patient', userId, 'appointment_created', 'appointment', appointmentId, `Booked with Dr. ${doctor.doctorName}`, req.ip);
  notify('admin', null, 'New appointment request', `A patient booked appointment #${appointmentId}.`);
  notify('doctor', doctor.id, 'New appointment request', `A patient booked appointment #${appointmentId}.`);
  flash(req, 'success', 'Your appointment request was submitted. You can track its status from appointment history.');
  res.redirect('/hms/appointment-history.php');
});

app.get('/hms/appointment-history.php', requireRole('patient', '/hms/user-login.php'), (req, res) => {
  const userId = req.session.userId;
  const appointments = db.appointments
    .filter((a) => Number(a.userId) === Number(userId))
    .map(enrichAppointment)
    .sort((a, b) => b.id - a.id);
  res.render('patient/appointment-history', { appointments });
});

app.post('/hms/appointment-history.php', requireRole('patient', '/hms/user-login.php'), (req, res) => {
  const userId = req.session.userId;
  const action = String(req.body.action || '');
  const appointmentId = Number(req.body.appointment_id);
  const appointment = db.appointments.find((a) => Number(a.id) === appointmentId && Number(a.userId) === Number(userId));

  if (!appointment) {
    flash(req, 'danger', 'Appointment not found.');
    return res.redirect('/hms/appointment-history.php');
  }

  if (action === 'cancel') {
    setAppointmentStatus(appointmentId, 'Cancelled', 'patient', userId);
    notify('admin', null, 'Appointment cancelled', `Patient cancelled appointment #${appointmentId}.`);
    notify('doctor', appointment.doctorId, 'Appointment cancelled', `Patient cancelled appointment #${appointmentId}.`);
    flash(req, 'success', 'Appointment cancelled.');
    return res.redirect('/hms/appointment-history.php');
  }

  if (action === 'reschedule') {
    const newDate = String(req.body.appointment_date || '').trim();
    const newTime = normalizeTime(req.body.appointment_time);
    const avail = checkDoctorAvailability(appointment.doctorId, newDate, newTime, appointmentId);
    if (!avail.ok) {
      flash(req, 'danger', avail.reason);
      return res.redirect('/hms/appointment-history.php');
    }
    appointment.appointmentDate = newDate;
    appointment.appointmentTime = newTime;
    appointment.userStatus = 1;
    appointment.doctorStatus = 1;
    appointment.status = 'Pending';
    appointment.reschedule_reason = String(req.body.reason || '').trim() || null;
    logAudit('patient', userId, 'appointment_rescheduled', 'appointment', appointmentId, `Rescheduled to ${newDate} ${newTime}`, req.ip);
    notify('admin', null, 'Appointment rescheduled', `Patient requested a new time for appointment #${appointmentId}.`);
    notify('doctor', appointment.doctorId, 'Appointment rescheduled', `Appointment #${appointmentId} was moved to ${newDate} ${newTime}.`);
    flash(req, 'success', 'Appointment rescheduled and moved back to pending review.');
    return res.redirect('/hms/appointment-history.php');
  }

  res.redirect('/hms/appointment-history.php');
});

app.get('/hms/manage-medhistory.php', requireRole('patient', '/hms/user-login.php'), (req, res) => {
  const userId = req.session.userId;
  const userEmail = String(req.session.userEmail || '').toLowerCase();
  const prescriptions = db.prescriptions
    .filter((p) => Number(p.patient_user_id) === Number(userId))
    .map((p) => {
      const doc = db.doctors.find((d) => Number(d.id) === Number(p.doctor_id));
      return { ...p, doctorName: doc ? doc.doctorName : 'Doctor' };
    });
  const matchingPatientIds = db.patients
    .filter((pt) => String(pt.PatientEmail || '').toLowerCase() === userEmail)
    .map((pt) => pt.ID);
  const history = db.medicalHistory.filter((h) => matchingPatientIds.includes(h.PatientID));
  res.render('patient/medhistory', { prescriptions, history });
});

app.get('/hms/prescription-download.php', requireRole('patient', '/hms/user-login.php'), (req, res) => {
  const rxId = Number(req.query.id);
  const prescription = db.prescriptions.find(
    (p) => Number(p.id) === rxId && Number(p.patient_user_id) === Number(req.session.userId)
  );
  if (!prescription) {
    flash(req, 'danger', 'Prescription not found.');
    return res.redirect('/hms/appointment-history.php');
  }
  const doctor = db.doctors.find((d) => Number(d.id) === Number(prescription.doctor_id));
  const patient = db.users.find((u) => Number(u.id) === Number(prescription.patient_user_id));
  res.render('patient/prescription', { prescription, doctor, patient });
});

app.get('/hms/edit-profile.php', requireRole('patient', '/hms/user-login.php'), (req, res) => {
  const user = db.users.find((u) => Number(u.id) === Number(req.session.userId));
  res.render('patient/profile', { user });
});

app.post('/hms/edit-profile.php', requireRole('patient', '/hms/user-login.php'), (req, res) => {
  const user = db.users.find((u) => Number(u.id) === Number(req.session.userId));
  if (user) {
    user.fullName = String(req.body.fname || user.fullName).trim();
    user.city = String(req.body.city || user.city).trim();
    user.gender = String(req.body.gender || user.gender).trim();
    user.address = String(req.body.address || user.address).trim();
    user.updationDate = nowStr();
    req.session.userName = user.fullName;
    flash(req, 'success', 'Profile updated successfully.');
  }
  res.redirect('/hms/edit-profile.php');
});

app.get('/hms/change-password.php', requireRole('patient', '/hms/user-login.php'), (req, res) => {
  res.render('patient/change-password', { role: 'patient', actionUrl: '/hms/change-password.php' });
});

app.post('/hms/change-password.php', requireRole('patient', '/hms/user-login.php'), (req, res) => {
  const user = db.users.find((u) => Number(u.id) === Number(req.session.userId));
  const cpass = String(req.body.cpass || '');
  const npass = String(req.body.npass || '');
  const cfpass = String(req.body.cfpass || '');
  if (!user || !passwordMatches(cpass, user.password)) {
    flash(req, 'danger', 'Current password is incorrect.');
  } else if (npass.length < 6 || npass !== cfpass) {
    flash(req, 'danger', 'New passwords must match and be at least 6 characters.');
  } else {
    user.password = hashPassword(npass);
    user.updationDate = nowStr();
    flash(req, 'success', 'Password changed successfully.');
  }
  res.redirect('/hms/change-password.php');
});

app.get('/hms/logout.php', (req, res) => {
  req.session.destroy(() => res.redirect('/hms/user-login.php'));
});

// ---------- Doctor Portal ----------
app.get(['/hms/doctor', '/hms/doctor/', '/hms/doctor/index.php'], (req, res) => {
  if (req.session?.role === 'doctor') return res.redirect('/hms/doctor/dashboard.php');
  res.render('doctor/login');
});

app.post('/hms/doctor/index.php', (req, res) => {
  const email = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const doctor = db.doctors.find((d) => d.docEmail.toLowerCase() === email.toLowerCase());
  const ip = req.ip || '127.0.0.1';

  if (doctor && passwordMatches(password, doctor.password)) {
    if (!String(doctor.password).startsWith('$2')) {
      doctor.password = hashPassword(password);
    }
    req.session.userId = doctor.id;
    req.session.role = 'doctor';
    req.session.userName = doctor.doctorName;
    db.doctorLogs.unshift({
      id: nextId('doctorLogs'),
      uid: doctor.id,
      username: email,
      userip: ip,
      loginTime: nowStr(),
      logout: null,
      status: 1
    });
    return res.redirect('/hms/doctor/dashboard.php');
  }
  db.doctorLogs.unshift({
    id: nextId('doctorLogs'),
    uid: null,
    username: email,
    userip: ip,
    loginTime: nowStr(),
    logout: null,
    status: 0
  });
  flash(req, 'danger', 'Invalid email or password.');
  res.redirect('/hms/doctor/index.php');
});

app.get('/hms/doctor/dashboard.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  const doctorId = req.session.userId;
  const mine = db.appointments.filter((a) => Number(a.doctorId) === Number(doctorId)).map(enrichAppointment);
  const myPatients = db.patients.filter((p) => Number(p.Docid) === Number(doctorId));
  const followups = db.prescriptions
    .filter((p) => Number(p.doctor_id) === Number(doctorId) && p.followup_date)
    .map((p) => {
      const u = db.users.find((x) => Number(x.id) === Number(p.patient_user_id));
      return { ...p, fullName: u ? u.fullName : 'Patient' };
    });

  res.render('doctor/dashboard', {
    stats: {
      today: mine.filter((a) => a.appointmentDate === todayStr()).length,
      pending: mine.filter((a) => a.status === 'Pending').length,
      completed: mine.filter((a) => a.status === 'Completed').length,
      patients: myPatients.length
    },
    appointments: mine.slice().sort((a, b) => b.id - a.id),
    followups
  });
});

app.get('/hms/doctor/appointment-history.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  const doctorId = req.session.userId;
  const q = String(req.query.q || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim();
  const date = String(req.query.date || '').trim();

  let appointments = db.appointments.filter((a) => Number(a.doctorId) === Number(doctorId)).map(enrichAppointment);
  if (q) {
    appointments = appointments.filter(
      (a) =>
        a.fullName.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        a.doctorSpecialization.toLowerCase().includes(q)
    );
  }
  if (isValidStatus(status)) {
    appointments = appointments.filter((a) => a.status === status);
  }
  if (date) {
    appointments = appointments.filter((a) => a.appointmentDate === date);
  }
  appointments.sort((a, b) => b.id - a.id);
  res.render('doctor/appointment-history', { appointments, q: req.query.q || '', status, date });
});

app.post('/hms/doctor/appointment-history.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  const doctorId = req.session.userId;
  const appointmentId = Number(req.body.appointment_id);
  const status = String(req.body.status || '');
  const appointment = db.appointments.find((a) => Number(a.id) === appointmentId && Number(a.doctorId) === Number(doctorId));

  if (appointment && setAppointmentStatus(appointmentId, status, 'doctor', doctorId)) {
    notify('patient', appointment.userId, 'Appointment status updated', `Your appointment is now ${status}.`);
    notify('admin', null, 'Appointment status updated', `Doctor updated appointment #${appointmentId} to ${status}.`);
    flash(req, 'success', 'Appointment status updated.');
  } else {
    flash(req, 'danger', 'Unable to update appointment status.');
  }
  res.redirect('/hms/doctor/appointment-history.php');
});

app.get('/hms/doctor/availability.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  const slots = db.doctorAvailability.filter((s) => Number(s.doctor_id) === Number(req.session.userId));
  res.render('doctor/availability', { slots, days: DAYS });
});

app.post('/hms/doctor/availability.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  const doctorId = req.session.userId;
  const action = String(req.body.action || 'create');
  if (action === 'delete') {
    const id = Number(req.body.id);
    const idx = db.doctorAvailability.findIndex((s) => Number(s.id) === id && Number(s.doctor_id) === Number(doctorId));
    if (idx !== -1) {
      db.doctorAvailability.splice(idx, 1);
      logAudit('doctor', doctorId, 'availability_deleted', 'doctor_availability', id, '', req.ip);
      flash(req, 'success', 'Availability slot removed.');
    }
    return res.redirect('/hms/doctor/availability.php');
  }

  const day = Number(req.body.day_of_week);
  const date = req.body.available_date ? String(req.body.available_date).trim() : null;
  const start = normalizeTime(req.body.start_time);
  const end = normalizeTime(req.body.end_time);
  const duration = Math.max(5, Number(req.body.slot_duration_minutes || 30));
  const maxAppointments = Math.max(1, Number(req.body.max_appointments || 1));

  if (day < 0 || day > 6 || !start || !end || start >= end) {
    flash(req, 'danger', 'Please enter a valid day and time range.');
    return res.redirect('/hms/doctor/availability.php');
  }
  const id = nextId('doctorAvailability');
  db.doctorAvailability.push({
    id,
    doctor_id: doctorId,
    day_of_week: day,
    available_date: date,
    start_time: start,
    end_time: end,
    slot_duration_minutes: duration,
    max_appointments: maxAppointments,
    is_active: 1,
    created_at: nowStr()
  });
  logAudit('doctor', doctorId, 'availability_created', 'doctor_availability', id, 'Created availability slot.', req.ip);
  flash(req, 'success', 'Availability slot saved.');
  res.redirect('/hms/doctor/availability.php');
});

app.get('/hms/doctor/prescriptions.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  const doctorId = req.session.userId;
  const selectedId = Number(req.query.appointment_id || 0);
  const appointments = db.appointments
    .filter((a) => Number(a.doctorId) === Number(doctorId) && a.status !== 'Cancelled')
    .map(enrichAppointment);
  const existing = selectedId
    ? db.prescriptions.find((p) => Number(p.appointment_id) === selectedId && Number(p.doctor_id) === Number(doctorId))
    : null;
  const prescriptions = db.prescriptions
    .filter((p) => Number(p.doctor_id) === Number(doctorId))
    .map((p) => {
      const u = db.users.find((x) => Number(x.id) === Number(p.patient_user_id));
      return { ...p, fullName: u ? u.fullName : 'Patient' };
    });
  res.render('doctor/prescriptions', { appointments, selectedId, existing, prescriptions });
});

app.post('/hms/doctor/prescriptions.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  const doctorId = req.session.userId;
  const appointmentId = Number(req.body.appointment_id);
  const appt = db.appointments.find((a) => Number(a.id) === appointmentId && Number(a.doctorId) === Number(doctorId));
  if (!appt) {
    flash(req, 'danger', 'Appointment not found.');
    return res.redirect('/hms/doctor/prescriptions.php');
  }
  const diagnosis = String(req.body.diagnosis || '').trim();
  const treatment = String(req.body.treatment || '').trim();
  const medicines = String(req.body.medicines || '').trim();
  const notes = String(req.body.notes || '').trim();
  const followup_date = String(req.body.followup_date || '').trim() || null;

  let rx = db.prescriptions.find((p) => Number(p.appointment_id) === appointmentId);
  if (rx) {
    rx.diagnosis = diagnosis;
    rx.treatment = treatment;
    rx.medicines = medicines;
    rx.notes = notes;
    rx.followup_date = followup_date;
    rx.updated_at = nowStr();
  } else {
    db.prescriptions.push({
      id: nextId('prescriptions'),
      appointment_id: appointmentId,
      doctor_id: doctorId,
      patient_user_id: appt.userId,
      diagnosis,
      treatment,
      medicines,
      notes,
      followup_date,
      created_at: nowStr(),
      updated_at: nowStr()
    });
  }
  setAppointmentStatus(appointmentId, 'Completed', 'doctor', doctorId);
  const patient = db.users.find((u) => Number(u.id) === Number(appt.userId));
  logAudit('doctor', doctorId, 'prescription_saved', 'appointment', appointmentId, `Prescription saved for ${patient ? patient.fullName : 'Patient'}`, req.ip);
  notify('patient', appt.userId, 'Prescription available', `Your prescription for appointment #${appointmentId} is ready to download.`);
  flash(req, 'success', 'Prescription saved and appointment marked Completed.');
  res.redirect(`/hms/doctor/prescriptions.php?appointment_id=${appointmentId}`);
});

app.get('/hms/doctor/manage-patient.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  const patients = db.patients.filter((p) => Number(p.Docid) === Number(req.session.userId));
  res.render('doctor/manage-patient', { patients });
});

app.get('/hms/doctor/add-patient.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  res.render('doctor/patient-form', { patient: null, actionUrl: '/hms/doctor/add-patient.php' });
});

app.post('/hms/doctor/add-patient.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  const doctorId = req.session.userId;
  const id = nextId('patients');
  const PatientName = String(req.body.patname || '').trim();
  db.patients.push({
    ID: id,
    Docid: doctorId,
    PatientName,
    PatientContno: String(req.body.patcontact || '').trim(),
    PatientEmail: String(req.body.patemail || '').trim(),
    PatientGender: String(req.body.gender || 'Male').trim(),
    PatientAdd: String(req.body.pataddress || '').trim(),
    PatientAge: Number(req.body.patage || 0),
    PatientMedhis: String(req.body.medhis || '').trim(),
    CreationDate: nowStr(),
    UpdationDate: null
  });
  logAudit('doctor', doctorId, 'patient_created', 'tblpatient', id, `Patient created: ${PatientName}`, req.ip);
  flash(req, 'success', 'Patient added successfully.');
  res.redirect('/hms/doctor/manage-patient.php');
});

app.get('/hms/doctor/edit-patient.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  const id = Number(req.query.editid);
  const patient = db.patients.find((p) => Number(p.ID) === id && Number(p.Docid) === Number(req.session.userId));
  if (!patient) {
    flash(req, 'danger', 'Patient not found.');
    return res.redirect('/hms/doctor/manage-patient.php');
  }
  res.render('doctor/patient-form', { patient, actionUrl: `/hms/doctor/edit-patient.php?editid=${id}` });
});

app.post('/hms/doctor/edit-patient.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  const id = Number(req.query.editid);
  const patient = db.patients.find((p) => Number(p.ID) === id && Number(p.Docid) === Number(req.session.userId));
  if (patient) {
    patient.PatientName = String(req.body.patname || patient.PatientName).trim();
    patient.PatientContno = String(req.body.patcontact || patient.PatientContno).trim();
    patient.PatientEmail = String(req.body.patemail || patient.PatientEmail).trim();
    patient.PatientGender = String(req.body.gender || patient.PatientGender).trim();
    patient.PatientAge = Number(req.body.patage || patient.PatientAge);
    patient.PatientAdd = String(req.body.pataddress || patient.PatientAdd).trim();
    patient.PatientMedhis = String(req.body.medhis || patient.PatientMedhis).trim();
    patient.UpdationDate = nowStr();
    flash(req, 'success', 'Patient updated successfully.');
  }
  res.redirect('/hms/doctor/manage-patient.php');
});

app.get('/hms/doctor/view-patient.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  const id = Number(req.query.viewid);
  const patient = db.patients.find((p) => Number(p.ID) === id && Number(p.Docid) === Number(req.session.userId));
  if (!patient) {
    flash(req, 'danger', 'Patient not found.');
    return res.redirect('/hms/doctor/manage-patient.php');
  }
  const history = db.medicalHistory.filter((h) => Number(h.PatientID) === id);
  res.render('doctor/view-patient', {
    role: 'doctor',
    patient,
    history,
    actionUrl: `/hms/doctor/view-patient.php?viewid=${id}`
  });
});

app.post('/hms/doctor/view-patient.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  const id = Number(req.query.viewid);
  db.medicalHistory.unshift({
    ID: nextId('medicalHistory'),
    PatientID: id,
    BloodPressure: String(req.body.bp || '').trim(),
    BloodSugar: String(req.body.bs || '').trim(),
    Weight: String(req.body.weight || '').trim(),
    Temperature: String(req.body.temp || '').trim(),
    MedicalPres: String(req.body.pres || '').trim(),
    CreationDate: nowStr()
  });
  flash(req, 'success', 'Medical history added.');
  res.redirect(`/hms/doctor/view-patient.php?viewid=${id}`);
});

app.get('/hms/doctor/edit-profile.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  const doctor = db.doctors.find((d) => Number(d.id) === Number(req.session.userId));
  res.render('doctor/edit-profile', { doctor, specializations: db.specializations });
});

app.post('/hms/doctor/edit-profile.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  const doctor = db.doctors.find((d) => Number(d.id) === Number(req.session.userId));
  if (doctor) {
    doctor.specilization = String(req.body.Doctorspecialization || doctor.specilization).trim();
    doctor.doctorName = String(req.body.docname || doctor.doctorName).trim();
    doctor.docFees = String(req.body.docfees || doctor.docFees).trim();
    doctor.contactno = String(req.body.doccontact || doctor.contactno).trim();
    doctor.address = String(req.body.clinicaddress || doctor.address).trim();
    doctor.updationDate = nowStr();
    req.session.userName = doctor.doctorName;
    flash(req, 'success', 'Doctor profile updated.');
  }
  res.redirect('/hms/doctor/edit-profile.php');
});

app.get('/hms/doctor/change-password.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  res.render('patient/change-password', { role: 'doctor', actionUrl: '/hms/doctor/change-password.php' });
});

app.post('/hms/doctor/change-password.php', requireRole('doctor', '/hms/doctor/index.php'), (req, res) => {
  const doctor = db.doctors.find((d) => Number(d.id) === Number(req.session.userId));
  const cpass = String(req.body.cpass || '');
  const npass = String(req.body.npass || '');
  const cfpass = String(req.body.cfpass || '');
  if (!doctor || !passwordMatches(cpass, doctor.password)) {
    flash(req, 'danger', 'Current password is incorrect.');
  } else if (npass.length < 6 || npass !== cfpass) {
    flash(req, 'danger', 'New passwords must match and be at least 6 characters.');
  } else {
    doctor.password = hashPassword(npass);
    doctor.updationDate = nowStr();
    flash(req, 'success', 'Password changed successfully.');
  }
  res.redirect('/hms/doctor/change-password.php');
});

app.get('/hms/doctor/logout.php', (req, res) => {
  req.session.destroy(() => res.redirect('/hms/doctor/index.php'));
});

// ---------- Admin Portal ----------
app.get(['/hms/admin', '/hms/admin/', '/hms/admin/index.php'], (req, res) => {
  if (req.session?.role === 'admin') return res.redirect('/hms/admin/dashboard.php');
  res.render('admin/login');
});

app.post('/hms/admin/index.php', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const admin = db.admins.find((a) => a.username === username);
  if (admin && passwordMatches(password, admin.password)) {
    if (!String(admin.password).startsWith('$2')) {
      admin.password = hashPassword(password);
    }
    req.session.userId = admin.id;
    req.session.role = 'admin';
    req.session.userName = admin.username;
    logAudit('admin', admin.id, 'admin_login', 'admin', admin.id, 'Admin logged in.', req.ip);
    return res.redirect('/hms/admin/dashboard.php');
  }
  flash(req, 'danger', 'Invalid username or password.');
  res.redirect('/hms/admin/index.php');
});

app.get('/hms/admin/dashboard.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const statusLabels = VALID_STATUSES;
  const statusTotals = statusLabels.map((s) => db.appointments.filter((a) => a.status === s).length);
  const unreadNotifications = db.notifications.filter((n) => n.user_type === 'admin' && Number(n.is_read) === 0).length;
  res.render('admin/dashboard', {
    stats: {
      users: db.users.length,
      doctors: db.doctors.length,
      patients: db.patients.length,
      appointments: db.appointments.length,
      newQueries: db.contactQueries.filter((q) => q.IsRead == null).length
    },
    statusLabels,
    statusTotals,
    unreadNotifications,
    recentAppointments: db.appointments.map(enrichAppointment).sort((a, b) => b.id - a.id).slice(0, 6),
    recentActivities: db.auditLogs.slice(0, 6)
  });
});

function filterAdminAppointments(query) {
  const q = String(query.q || '').trim().toLowerCase();
  const status = String(query.status || '').trim();
  const from = String(query.from || '').trim();
  const to = String(query.to || '').trim();
  const doctor = Number(query.doctor || 0);

  let rows = db.appointments.map(enrichAppointment);
  if (q) {
    rows = rows.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.doctorName.toLowerCase().includes(q) ||
        r.doctorSpecialization.toLowerCase().includes(q)
    );
  }
  if (isValidStatus(status)) rows = rows.filter((r) => r.status === status);
  if (from) rows = rows.filter((r) => r.appointmentDate >= from);
  if (to) rows = rows.filter((r) => r.appointmentDate <= to);
  if (doctor > 0) rows = rows.filter((r) => Number(r.doctorId) === doctor);
  rows.sort((a, b) => b.id - a.id);
  return { rows, filters: { q: query.q || '', status, from, to, doctor } };
}

app.get('/hms/admin/appointment-history.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const { rows, filters } = filterAdminAppointments(req.query);
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, String(v));
  });
  res.render('admin/appointment-history', {
    rows,
    filters,
    doctors: db.doctors,
    queryString: params.toString()
  });
});

app.post('/hms/admin/appointment-history.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const adminId = req.session.userId;
  const appointmentId = Number(req.body.appointment_id);
  const status = String(req.body.status || '');
  const appointment = db.appointments.find((a) => Number(a.id) === appointmentId);
  if (appointment && setAppointmentStatus(appointmentId, status, 'admin', adminId)) {
    notify('patient', appointment.userId, 'Appointment status updated', `Your appointment is now ${status}.`);
    notify('doctor', appointment.doctorId, 'Appointment status updated', `Appointment #${appointmentId} is now ${status}.`);
    flash(req, 'success', 'Appointment status updated.');
  } else {
    flash(req, 'danger', 'Unable to update appointment status.');
  }
  res.redirect('/hms/admin/appointment-history.php');
});

app.get('/hms/admin/export-appointments.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const { rows } = filterAdminAppointments(req.query);
  const header = ['ID', 'Patient', 'Doctor', 'Specialization', 'Fee', 'Date', 'Time', 'Status', 'Created At'];
  const csvLines = [header.join(',')].concat(
    rows.map((r) =>
      [r.id, r.fullName, r.doctorName, r.doctorSpecialization, r.consultancyFees, r.appointmentDate, r.appointmentTime, r.status, r.postingDate]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(',')
    )
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="appointments-report.csv"');
  res.send(csvLines.join('\n'));
});

app.get('/hms/admin/doctor-availability.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const slots = db.doctorAvailability.map((s) => {
    const doc = db.doctors.find((d) => Number(d.id) === Number(s.doctor_id));
    return { ...s, doctorName: doc ? doc.doctorName : 'Doctor' };
  });
  res.render('admin/doctor-availability', { doctors: db.doctors, slots, days: DAYS });
});

app.post('/hms/admin/doctor-availability.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const adminId = req.session.userId;
  const action = String(req.body.action || 'create');
  if (action === 'delete') {
    const id = Number(req.body.id);
    const idx = db.doctorAvailability.findIndex((s) => Number(s.id) === id);
    if (idx !== -1) {
      db.doctorAvailability.splice(idx, 1);
      logAudit('admin', adminId, 'availability_deleted', 'doctor_availability', id, '', req.ip);
      flash(req, 'success', 'Availability slot removed.');
    }
    return res.redirect('/hms/admin/doctor-availability.php');
  }

  const doctorId = Number(req.body.doctor_id);
  const day = Number(req.body.day_of_week);
  const date = req.body.available_date ? String(req.body.available_date).trim() : null;
  const start = normalizeTime(req.body.start_time);
  const end = normalizeTime(req.body.end_time);
  const duration = Math.max(5, Number(req.body.slot_duration_minutes || 30));
  const maxAppointments = Math.max(1, Number(req.body.max_appointments || 1));

  if (!doctorId || day < 0 || day > 6 || !start || !end || start >= end) {
    flash(req, 'danger', 'Please enter a valid doctor, day, and time range.');
    return res.redirect('/hms/admin/doctor-availability.php');
  }
  const id = nextId('doctorAvailability');
  db.doctorAvailability.push({
    id,
    doctor_id: doctorId,
    day_of_week: day,
    available_date: date,
    start_time: start,
    end_time: end,
    slot_duration_minutes: duration,
    max_appointments: maxAppointments,
    is_active: 1,
    created_at: nowStr()
  });
  logAudit('admin', adminId, 'availability_created', 'doctor_availability', id, 'Created doctor availability slot.', req.ip);
  flash(req, 'success', 'Availability slot saved.');
  res.redirect('/hms/admin/doctor-availability.php');
});

app.get('/hms/admin/manage-doctors.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  res.render('admin/manage-doctors', { doctors: db.doctors.slice().sort((a, b) => b.id - a.id) });
});

app.post('/hms/admin/manage-doctors.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const doctorId = Number(req.body.id);
  const idx = db.doctors.findIndex((d) => Number(d.id) === doctorId);
  if (idx !== -1) {
    db.doctors.splice(idx, 1);
    logAudit('admin', req.session.userId, 'doctor_deleted', 'doctors', doctorId, 'Doctor deleted.', req.ip);
    flash(req, 'success', 'Doctor deleted successfully.');
  }
  res.redirect('/hms/admin/manage-doctors.php');
});

app.get('/hms/admin/add-doctor.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  res.render('admin/doctor-form', { doctor: null, specializations: db.specializations, actionUrl: '/hms/admin/add-doctor.php' });
});

app.post('/hms/admin/add-doctor.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const specilization = String(req.body.Doctorspecialization || '').trim();
  const doctorName = String(req.body.docname || '').trim();
  const address = String(req.body.clinicaddress || '').trim();
  const docFees = String(req.body.docfees || '').trim();
  const contactno = String(req.body.doccontact || '').trim();
  const docEmail = String(req.body.docemail || '').trim();
  const npass = String(req.body.npass || '');
  const cfpass = String(req.body.cfpass || '');

  if (!specilization || !doctorName || !docEmail) {
    flash(req, 'danger', 'Please complete required doctor details.');
    return res.redirect('/hms/admin/add-doctor.php');
  }
  if (!npass || npass !== cfpass) {
    flash(req, 'danger', 'Password and confirm password must match.');
    return res.redirect('/hms/admin/add-doctor.php');
  }
  if (db.doctors.some((d) => d.docEmail.toLowerCase() === docEmail.toLowerCase())) {
    flash(req, 'danger', 'This doctor email is already registered.');
    return res.redirect('/hms/admin/add-doctor.php');
  }
  const id = nextId('doctors');
  db.doctors.push({
    id,
    specilization,
    doctorName,
    address,
    docFees,
    contactno,
    docEmail,
    password: hashPassword(npass),
    creationDate: nowStr(),
    updationDate: null
  });
  logAudit('admin', req.session.userId, 'doctor_created', 'doctors', id, `Doctor created: ${doctorName}`, req.ip);
  flash(req, 'success', 'Doctor added successfully.');
  res.redirect('/hms/admin/manage-doctors.php');
});

app.get('/hms/admin/edit-doctor.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const id = Number(req.query.id);
  const doctor = db.doctors.find((d) => Number(d.id) === id);
  if (!doctor) {
    flash(req, 'danger', 'Doctor not found.');
    return res.redirect('/hms/admin/manage-doctors.php');
  }
  res.render('admin/doctor-form', {
    doctor,
    specializations: db.specializations,
    actionUrl: `/hms/admin/edit-doctor.php?id=${id}`
  });
});

app.post('/hms/admin/edit-doctor.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const id = Number(req.query.id);
  const doctor = db.doctors.find((d) => Number(d.id) === id);
  if (doctor) {
    doctor.specilization = String(req.body.Doctorspecialization || doctor.specilization).trim();
    doctor.doctorName = String(req.body.docname || doctor.doctorName).trim();
    doctor.docFees = String(req.body.docfees || doctor.docFees).trim();
    doctor.contactno = String(req.body.doccontact || doctor.contactno).trim();
    doctor.address = String(req.body.clinicaddress || doctor.address).trim();
    doctor.updationDate = nowStr();
    flash(req, 'success', 'Doctor updated successfully.');
  }
  res.redirect('/hms/admin/manage-doctors.php');
});

app.get('/hms/admin/doctor-specilization.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  res.render('admin/specializations', { specializations: db.specializations });
});

app.post('/hms/admin/doctor-specilization.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  if (req.body.action === 'delete') {
    const id = Number(req.body.id);
    const idx = db.specializations.findIndex((s) => Number(s.id) === id);
    if (idx !== -1) {
      db.specializations.splice(idx, 1);
      flash(req, 'success', 'Specialization deleted.');
    }
    return res.redirect('/hms/admin/doctor-specilization.php');
  }
  const name = String(req.body.doctorspecilization || '').trim();
  if (name) {
    db.specializations.push({
      id: nextId('specializations'),
      specilization: name,
      creationDate: nowStr(),
      updationDate: null
    });
    flash(req, 'success', 'Doctor specialization added.');
  }
  res.redirect('/hms/admin/doctor-specilization.php');
});

app.get('/hms/admin/manage-users.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  res.render('admin/manage-users', { users: db.users.slice().sort((a, b) => b.id - a.id) });
});

app.post('/hms/admin/manage-users.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const userId = Number(req.body.id);
  const idx = db.users.findIndex((u) => Number(u.id) === userId);
  if (idx !== -1) {
    db.users.splice(idx, 1);
    logAudit('admin', req.session.userId, 'patient_user_deleted', 'users', userId, 'Patient user deleted.', req.ip);
    flash(req, 'success', 'User deleted successfully.');
  }
  res.redirect('/hms/admin/manage-users.php');
});

app.get('/hms/admin/manage-patient.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const patients = db.patients.map((p) => {
    const doc = db.doctors.find((d) => Number(d.id) === Number(p.Docid));
    return { ...p, doctorName: doc ? doc.doctorName : 'Unassigned' };
  });
  res.render('admin/manage-patient', { patients });
});

app.get('/hms/admin/view-patient.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const id = Number(req.query.viewid);
  const patient = db.patients.find((p) => Number(p.ID) === id);
  if (!patient) {
    flash(req, 'danger', 'Patient record not found.');
    return res.redirect('/hms/admin/manage-patient.php');
  }
  const history = db.medicalHistory.filter((h) => Number(h.PatientID) === id);
  res.render('doctor/view-patient', {
    role: 'admin',
    patient,
    history,
    actionUrl: `/hms/admin/view-patient.php?viewid=${id}`
  });
});

app.post('/hms/admin/view-patient.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const id = Number(req.query.viewid);
  db.medicalHistory.unshift({
    ID: nextId('medicalHistory'),
    PatientID: id,
    BloodPressure: String(req.body.bp || '').trim(),
    BloodSugar: String(req.body.bs || '').trim(),
    Weight: String(req.body.weight || '').trim(),
    Temperature: String(req.body.temp || '').trim(),
    MedicalPres: String(req.body.pres || '').trim(),
    CreationDate: nowStr()
  });
  logAudit('admin', req.session.userId, 'medical_history_added', 'tblpatient', id, 'Admin added medical history.', req.ip);
  flash(req, 'success', 'Medical history added.');
  res.redirect(`/hms/admin/view-patient.php?viewid=${id}`);
});

app.get('/hms/admin/notifications.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const notifications = db.notifications
    .filter((n) => n.user_type === 'admin')
    .sort((a, b) => a.is_read - b.is_read || b.id - a.id);
  const queries = db.contactQueries.filter((q) => q.IsRead == null);
  res.render('admin/notifications', { notifications, queries });
});

app.post('/hms/admin/notifications.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const id = Number(req.body.id || 0);
  db.notifications.forEach((n) => {
    if (n.user_type === 'admin' && (id === 0 || Number(n.id) === id)) {
      n.is_read = 1;
      n.read_at = nowStr();
    }
  });
  flash(req, 'success', 'Notifications updated.');
  res.redirect('/hms/admin/notifications.php');
});

app.get('/hms/admin/unread-queries.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  res.render('admin/queries', {
    heading: 'Unread Contact Queries',
    queries: db.contactQueries.filter((q) => q.IsRead == null)
  });
});

app.get('/hms/admin/read-query.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  res.render('admin/queries', {
    heading: 'Read Contact Queries',
    queries: db.contactQueries.filter((q) => q.IsRead != null)
  });
});

app.get('/hms/admin/query-details.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const id = Number(req.query.id);
  const query = db.contactQueries.find((q) => Number(q.id) === id);
  if (!query) {
    flash(req, 'danger', 'Query not found.');
    return res.redirect('/hms/admin/unread-queries.php');
  }
  res.render('admin/query-details', { query });
});

app.post('/hms/admin/query-details.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const id = Number(req.query.id);
  const query = db.contactQueries.find((q) => Number(q.id) === id);
  const remark = String(req.body.adminremark || '').trim();
  if (query && remark) {
    query.AdminRemark = remark;
    query.IsRead = 1;
    query.LastupdationDate = nowStr();
    logAudit('admin', req.session.userId, 'query_replied', 'tblcontactus', id, 'Admin replied to contact query.', req.ip);
    flash(req, 'success', 'Admin remark updated successfully.');
    return res.redirect('/hms/admin/read-query.php');
  }
  flash(req, 'danger', 'Please enter an admin remark.');
  res.redirect(`/hms/admin/query-details.php?id=${id}`);
});

app.get('/hms/admin/audit-logs.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const actor = String(req.query.actor || '').trim();
  const action = String(req.query.action || '').trim().toLowerCase();
  let logs = db.auditLogs;
  if (actor) logs = logs.filter((l) => l.actor_type === actor);
  if (action) logs = logs.filter((l) => l.action.toLowerCase().includes(action));
  res.render('admin/audit-logs', { logs, actor, action: req.query.action || '' });
});

app.get('/hms/admin/between-dates-reports.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  res.render('admin/reports', { fromdate: '', todate: '', results: null });
});

app.post('/hms/admin/betweendates-detailsreports.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const fromdate = String(req.body.fromdate || '').trim();
  const todate = String(req.body.todate || '').trim();
  const results = db.patients.filter((p) => {
    const d = String(p.CreationDate || '').slice(0, 10);
    return (!fromdate || d >= fromdate) && (!todate || d <= todate);
  });
  res.render('admin/reports', { fromdate, todate, results });
});

app.get('/hms/admin/about-us.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const page = db.pages.find((p) => p.PageType === 'aboutus');
  res.render('admin/cms-page', {
    heading: 'About Us Content',
    subtitle: 'Update the public website About section.',
    active: 'aboutus',
    actionUrl: '/hms/admin/about-us.php',
    isContact: false,
    page
  });
});

app.post('/hms/admin/about-us.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const page = db.pages.find((p) => p.PageType === 'aboutus');
  if (page) {
    page.PageTitle = String(req.body.pagetitle || page.PageTitle).trim();
    page.PageDescription = String(req.body.pagedes || page.PageDescription).trim();
    page.UpdationDate = nowStr();
    flash(req, 'success', 'About Us content updated.');
  }
  res.redirect('/hms/admin/about-us.php');
});

app.get('/hms/admin/contact.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const page = db.pages.find((p) => p.PageType === 'contactus');
  res.render('admin/cms-page', {
    heading: 'Contact Content',
    subtitle: 'Update the public website contact details.',
    active: 'contactus',
    actionUrl: '/hms/admin/contact.php',
    isContact: true,
    page
  });
});

app.post('/hms/admin/contact.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const page = db.pages.find((p) => p.PageType === 'contactus');
  if (page) {
    page.PageTitle = String(req.body.pagetitle || page.PageTitle).trim();
    page.PageDescription = String(req.body.pagedes || page.PageDescription).trim();
    page.Email = String(req.body.email || page.Email).trim();
    page.MobileNumber = String(req.body.mobnum || page.MobileNumber).trim();
    page.UpdationDate = nowStr();
    flash(req, 'success', 'Contact Us content updated.');
  }
  res.redirect('/hms/admin/contact.php');
});

app.get('/hms/admin/change-password.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  res.render('patient/change-password', { role: 'admin', actionUrl: '/hms/admin/change-password.php' });
});

app.post('/hms/admin/change-password.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const admin = db.admins.find((a) => Number(a.id) === Number(req.session.userId));
  const cpass = String(req.body.cpass || '');
  const npass = String(req.body.npass || '');
  const cfpass = String(req.body.cfpass || '');
  if (!admin || !passwordMatches(cpass, admin.password)) {
    flash(req, 'danger', 'Current password is incorrect.');
  } else if (npass.length < 6 || npass !== cfpass) {
    flash(req, 'danger', 'New passwords must match and be at least 6 characters.');
  } else {
    admin.password = hashPassword(npass);
    admin.updationDate = nowStr();
    flash(req, 'success', 'Password changed successfully.');
  }
  res.redirect('/hms/admin/change-password.php');
});

app.get('/hms/admin/logout.php', (req, res) => {
  req.session.destroy(() => res.redirect('/hms/admin/index.php'));
});

// Fallback 501 stub for any unmigrated legacy endpoints
app.all('/hms/*', (req, res) => {
  res.status(501).json({ error: 'Not yet migrated', path: req.path });
});

app.listen(PORT, HOST, () => {
  console.log(`Hospital Management System running on http://${HOST}:${PORT}`);
});
