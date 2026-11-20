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
import { getTranslator } from './src/i18n.js';

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
app.use('/src/assets/images', express.static(path.join(__dirname, 'src/assets/images')));

app.use((req, res, next) => {
  const queryLang = req.query.lang === 'pt' || req.query.lang === 'en' ? req.query.lang : null;
  if (queryLang && req.session) req.session.lang = queryLang;
  let lang = req.session?.lang;
  if (lang !== 'pt' && lang !== 'en') {
    const accept = String(req.headers['accept-language'] || '').toLowerCase();
    lang = accept.startsWith('en') ? 'en' : 'pt';
  }
  res.locals.lang = lang;
  res.locals.t = getTranslator(lang);
  res.locals.currentUrl = req.originalUrl || '/';
  res.locals.flashes = consumeFlashes(req);
  res.locals.currentUserName = req.session?.userName || '';
  res.locals.statusBadge = (status) => statusBadge(status, lang);
  res.locals.today = todayStr();
  next();
});

app.get('/lang/:code', (req, res) => {
  const code = req.params.code === 'en' ? 'en' : 'pt';
  if (req.session) req.session.lang = code;
  const nextUrl = String(req.query.next || '/');
  const safeNext = nextUrl.startsWith('/') && !nextUrl.startsWith('//') ? nextUrl : '/';
  res.redirect(safeNext);
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
    contactSubmitted: req.query.contact === 'ok',
    availableBeds: db.beds.filter((b) => b.status === 'Available').length,
    totalBeds: db.beds.length,
    totalDoctors: db.doctors.length
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

function renderUnifiedAuth(req, res, defaultMode = 'login', defaultRole = 'patient') {
  const mode = req.query.mode === 'register' ? 'register' : defaultMode;
  const qRole = ['patient', 'doctor', 'admin'].includes(req.query.role) ? req.query.role : defaultRole;
  res.render('auth/portal-auth', {
    initialMode: mode,
    initialRole: qRole,
    specializations: db.specializations
  });
}

function performPatientLogin(req, res, failRedirect = '/hms/auth.php?role=patient') {
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
  flash(req, 'danger', res.locals.lang === 'pt' ? 'E-mail ou senha inválidos.' : 'Invalid email or password.');
  return res.redirect(failRedirect);
}

function performDoctorLogin(req, res, failRedirect = '/hms/auth.php?role=doctor') {
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
  flash(req, 'danger', res.locals.lang === 'pt' ? 'E-mail ou senha inválidos.' : 'Invalid email or password.');
  return res.redirect(failRedirect);
}

function performAdminLogin(req, res, failRedirect = '/hms/auth.php?role=admin') {
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
  flash(req, 'danger', res.locals.lang === 'pt' ? 'Usuário ou senha inválidos.' : 'Invalid username or password.');
  return res.redirect(failRedirect);
}

// ---------- Unified Multi-Step Auth ----------
app.get('/hms/auth.php', (req, res) => {
  if (req.session?.role === 'patient' && !req.query.role && !req.query.mode) return res.redirect('/hms/dashboard.php');
  if (req.session?.role === 'doctor' && !req.query.role && !req.query.mode) return res.redirect('/hms/doctor/dashboard.php');
  if (req.session?.role === 'admin' && !req.query.role && !req.query.mode) return res.redirect('/hms/admin/dashboard.php');
  renderUnifiedAuth(req, res, 'login', 'patient');
});

app.post('/hms/auth/login', (req, res) => {
  const role = String(req.body.role || 'patient');
  if (role === 'doctor') return performDoctorLogin(req, res, '/hms/auth.php?mode=login&role=doctor');
  if (role === 'admin') return performAdminLogin(req, res, '/hms/auth.php?mode=login&role=admin');
  return performPatientLogin(req, res, '/hms/auth.php?mode=login&role=patient');
});

app.post('/hms/auth/register', (req, res) => {
  const role = ['patient', 'doctor', 'admin'].includes(req.body.role) ? req.body.role : 'patient';
  const password = String(req.body.password || '');
  const confirm = String(req.body.password_again || '');
  const pt = res.locals.lang === 'pt';

  if (password.length < 6 || password !== confirm) {
    flash(req, 'danger', pt ? 'As senhas devem coincidir e ter ao menos 6 caracteres.' : 'Passwords must match and be at least 6 characters.');
    return res.redirect(`/hms/auth.php?mode=register&role=${role}`);
  }

  if (role === 'doctor') {
    const doctorName = String(req.body.full_name || '').trim();
    const docEmail = String(req.body.email || '').trim();
    const specilization = String(req.body.specialization || '').trim();
    const contactno = String(req.body.doccontact || '').trim();
    const docFees = String(req.body.docfees || '500').trim();
    const address = String(req.body.clinicaddress || '').trim();
    if (!doctorName || !docEmail || !specilization) {
      flash(req, 'danger', pt ? 'Preencha todos os dados obrigatórios do médico.' : 'Please complete all required physician fields.');
      return res.redirect('/hms/auth.php?mode=register&role=doctor');
    }
    if (db.doctors.some((d) => d.docEmail.toLowerCase() === docEmail.toLowerCase())) {
      flash(req, 'danger', pt ? 'Este e-mail médico já está cadastrado.' : 'This doctor email is already registered.');
      return res.redirect('/hms/auth.php?mode=register&role=doctor');
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
      password: hashPassword(password),
      creationDate: nowStr(),
      updationDate: null
    });
    logAudit('doctor', id, 'doctor_registered', 'doctors', id, `Self-registered Dr. ${doctorName}`, req.ip);
    flash(req, 'success', pt ? 'Cadastro médico realizado! Faça login para continuar.' : 'Physician account created! You can now log in.');
    return res.redirect('/hms/auth.php?mode=login&role=doctor');
  }

  if (role === 'admin') {
    const fullName = String(req.body.full_name || '').trim();
    const username = String(req.body.username || '').trim();
    const department = String(req.body.department || '').trim();
    if (!username || !fullName) {
      flash(req, 'danger', pt ? 'Informe nome completo e nome de usuário.' : 'Please enter full name and username.');
      return res.redirect('/hms/auth.php?mode=register&role=admin');
    }
    if (db.admins.some((a) => a.username.toLowerCase() === username.toLowerCase())) {
      flash(req, 'danger', pt ? 'Este usuário administrativo já existe.' : 'This admin username already exists.');
      return res.redirect('/hms/auth.php?mode=register&role=admin');
    }
    const id = nextId('admins');
    db.admins.push({
      id,
      username,
      fullName,
      department,
      password: hashPassword(password),
      updationDate: nowStr()
    });
    logAudit('admin', id, 'admin_registered', 'admin', id, `Registered admin ${username} (${department})`, req.ip);
    flash(req, 'success', pt ? 'Conta administrativa criada! Faça login para continuar.' : 'Admin account created! You can now log in.');
    return res.redirect('/hms/auth.php?mode=login&role=admin');
  }

  // Default: Patient registration
  const fullName = String(req.body.full_name || '').trim();
  const address = String(req.body.address || '').trim();
  const city = String(req.body.city || '').trim();
  const gender = String(req.body.gender || 'male').trim();
  const email = String(req.body.email || '').trim();

  if (!fullName || !email) {
    flash(req, 'danger', pt ? 'Preencha todos os campos obrigatórios.' : 'Please complete all required fields.');
    return res.redirect('/hms/auth.php?mode=register&role=patient');
  }
  if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    flash(req, 'danger', pt ? 'Este e-mail já está cadastrado.' : 'This email is already registered.');
    return res.redirect('/hms/auth.php?mode=register&role=patient');
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
  logAudit('patient', id, 'patient_registered', 'users', id, `Registered ${fullName}`, req.ip);
  flash(req, 'success', pt ? 'Conta criada! Você já pode entrar.' : 'Account created! You can now log in.');
  return res.redirect('/hms/auth.php?mode=login&role=patient');
});

// ---------- Patient Portal ----------
app.get(['/hms', '/hms/', '/hms/user-login.php', '/hms/login'], (req, res) => {
  if (req.session?.role === 'patient') return res.redirect('/hms/dashboard.php');
  renderUnifiedAuth(req, res, 'login', 'patient');
});

app.post('/hms/user-login.php', (req, res) => performPatientLogin(req, res, '/hms/user-login.php'));

app.get('/hms/registration.php', (req, res) => {
  renderUnifiedAuth(req, res, 'register', 'patient');
});

app.post('/hms/registration.php', (req, res) => {
  req.body.role = 'patient';
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
  const myLabs = db.labOrders.filter((l) => Number(l.patientUserId) === Number(userId));
  const myInvoices = db.invoices.filter((i) => Number(i.patientUserId) === Number(userId));
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
      prescriptions: myRx.length,
      labs: myLabs.length,
      unpaidInvoices: myInvoices.filter((i) => i.status === 'Unpaid').length
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

app.get('/hms/lab-results.php', requireRole('patient', '/hms/user-login.php'), (req, res) => {
  const userId = req.session.userId;
  const orders = db.labOrders
    .filter((l) => Number(l.patientUserId) === Number(userId))
    .map((l) => {
      const doc = db.doctors.find((d) => Number(d.id) === Number(l.doctorId));
      return { ...l, doctorName: doc ? doc.doctorName : 'Doctor' };
    })
    .sort((a, b) => b.id - a.id);
  res.render('patient/lab-results', { orders });
});

app.get('/hms/invoices.php', requireRole('patient', '/hms/user-login.php'), (req, res) => {
  const userId = req.session.userId;
  const invoices = db.invoices
    .filter((i) => Number(i.patientUserId) === Number(userId))
    .sort((a, b) => b.id - a.id);
  res.render('patient/invoices', { invoices });
});

app.post('/hms/invoices.php', requireRole('patient', '/hms/user-login.php'), (req, res) => {
  const userId = req.session.userId;
  const invoiceId = Number(req.body.invoice_id);
  const inv = db.invoices.find((i) => Number(i.id) === invoiceId && Number(i.patientUserId) === Number(userId));
  if (inv && inv.status === 'Unpaid') {
    inv.status = 'Paid';
    inv.paidAt = todayStr();
    inv.method = String(req.body.method || inv.method || 'PIX').trim();
    logAudit('patient', userId, 'invoice_paid', 'invoice', inv.id, `Paid invoice #${inv.id}`, req.ip);
    flash(req, 'success', res.locals.lang === 'pt' ? 'Guia marcada como paga.' : 'Invoice marked as paid.');
  }
  res.redirect('/hms/invoices.php');
});

app.get('/hms/logout.php', (req, res) => {
  req.session.destroy(() => res.redirect('/hms/user-login.php'));
});

// ---------- Doctor Portal ----------
app.get(['/hms/doctor', '/hms/doctor/', '/hms/doctor/index.php'], (req, res) => {
  if (req.session?.role === 'doctor') return res.redirect('/hms/doctor/dashboard.php');
  renderUnifiedAuth(req, res, 'login', 'doctor');
});

app.post('/hms/doctor/index.php', (req, res) => performDoctorLogin(req, res, '/hms/doctor/index.php'));

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
      patients: myPatients.length,
      triageWaiting: db.triageQueue.filter((t) => t.status === 'Waiting').length,
      availableBeds: db.beds.filter((b) => b.status === 'Available').length,
      pendingLabs: db.labOrders.filter((l) => Number(l.doctorId) === Number(doctorId) && l.status !== 'Completed').length
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

// Doctor hospital operation routes (triage, beds, lab-orders)
function handleTriageGet(role, actionUrl) {
  return (req, res) => {
    const priorityFilter = String(req.query.priority || '').trim();
    const statusFilter = String(req.query.status || '').trim();
    const priorityRank = { Emergency: 0, 'Very Urgent': 1, Urgent: 2, Standard: 3 };
    let queue = db.triageQueue.map((item) => {
      const doc = db.doctors.find((d) => Number(d.id) === Number(item.doctorId));
      return { ...item, doctorName: doc ? doc.doctorName : '-' };
    });
    if (priorityFilter) queue = queue.filter((q) => q.priority === priorityFilter);
    if (statusFilter) queue = queue.filter((q) => q.status === statusFilter);
    queue.sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) || b.id - a.id);
    res.render('shared/triage', {
      role,
      actionUrl,
      queue,
      doctors: db.doctors,
      priorityFilter,
      statusFilter
    });
  };
}

function handleTriagePost(role, redirectTo) {
  return (req, res) => {
    const action = String(req.body.action || 'create');
    if (action === 'update_status') {
      const id = Number(req.body.id);
      const status = String(req.body.status || '');
      const entry = db.triageQueue.find((t) => Number(t.id) === id);
      if (entry && ['Waiting', 'In Consultation', 'Admitted', 'Discharged'].includes(status)) {
        entry.status = status;
        logAudit(role, req.session.userId, 'triage_status_updated', 'triage', id, `Triage #${id} -> ${status}`, req.ip);
        flash(req, 'success', res.locals.lang === 'pt' ? 'Status de triagem atualizado.' : 'Triage status updated.');
      }
      return res.redirect(redirectTo);
    }
    const patientName = String(req.body.patientName || '').trim();
    const age = Number(req.body.age || 0);
    const priority = String(req.body.priority || 'Urgent').trim();
    const vitals = String(req.body.vitals || '').trim();
    const complaint = String(req.body.complaint || '').trim();
    const doctorId = Number(req.body.doctorId || 0) || null;
    if (patientName && complaint) {
      const id = nextId('triageQueue');
      db.triageQueue.unshift({
        id,
        patientName,
        age,
        priority,
        vitals,
        complaint,
        doctorId,
        status: 'Waiting',
        arrivedAt: nowStr().slice(0, 16)
      });
      logAudit(role, req.session.userId, 'triage_created', 'triage', id, `${patientName} (${priority})`, req.ip);
      if (doctorId) notify('doctor', doctorId, 'Emergency triage intake', `${patientName} assigned (${priority}).`);
      flash(req, 'success', res.locals.lang === 'pt' ? 'Paciente registrado na triagem.' : 'Patient added to triage queue.');
    }
    res.redirect(redirectTo);
  };
}

function handleBedsGet(role, actionUrl) {
  return (req, res) => {
    const wardFilter = String(req.query.ward || '').trim();
    const wards = Array.from(new Set(db.beds.map((b) => b.ward)));
    let beds = db.beds.map((b) => {
      const doc = db.doctors.find((d) => Number(d.id) === Number(b.doctorId));
      return { ...b, doctorName: doc ? doc.doctorName : '-' };
    });
    if (wardFilter) beds = beds.filter((b) => b.ward === wardFilter);
    res.render('shared/beds', {
      role,
      actionUrl,
      beds,
      wards,
      wardFilter,
      doctors: db.doctors,
      summary: {
        total: db.beds.length,
        available: db.beds.filter((b) => b.status === 'Available').length,
        occupied: db.beds.filter((b) => b.status === 'Occupied').length,
        maintenance: db.beds.filter((b) => b.status === 'Maintenance').length
      }
    });
  };
}

function handleBedsPost(role, redirectTo) {
  return (req, res) => {
    const id = Number(req.body.id);
    const action = String(req.body.action || '');
    const bed = db.beds.find((b) => Number(b.id) === id);
    if (!bed) return res.redirect(redirectTo);

    if (action === 'admit') {
      const patientName = String(req.body.patientName || '').trim();
      const doctorId = Number(req.body.doctorId || 0) || null;
      const notes = String(req.body.notes || '').trim();
      if (patientName) {
        bed.status = 'Occupied';
        bed.patientName = patientName;
        bed.doctorId = doctorId;
        bed.admittedAt = nowStr().slice(0, 16);
        bed.notes = notes;
        logAudit(role, req.session.userId, 'bed_admitted', 'bed', bed.id, `${bed.code}: ${patientName}`, req.ip);
        flash(req, 'success', res.locals.lang === 'pt' ? `Paciente internado no leito ${bed.code}.` : `Patient admitted to bed ${bed.code}.`);
      }
    } else if (action === 'discharge') {
      logAudit(role, req.session.userId, 'bed_discharged', 'bed', bed.id, `${bed.code}: ${bed.patientName}`, req.ip);
      bed.status = 'Available';
      bed.patientName = '';
      bed.doctorId = null;
      bed.admittedAt = null;
      bed.notes = '';
      flash(req, 'success', res.locals.lang === 'pt' ? `Leito ${bed.code} liberado.` : `Bed ${bed.code} discharged and available.`);
    } else if (action === 'maintenance') {
      if (bed.status === 'Maintenance') {
        bed.status = 'Available';
        bed.notes = '';
      } else if (bed.status === 'Available') {
        bed.status = 'Maintenance';
        bed.notes = String(req.body.notes || 'Sanitization / Maintenance').trim();
      }
      logAudit(role, req.session.userId, 'bed_status_changed', 'bed', bed.id, `${bed.code} -> ${bed.status}`, req.ip);
      flash(req, 'success', res.locals.lang === 'pt' ? 'Status do leito atualizado.' : 'Bed status updated.');
    }
    res.redirect(redirectTo);
  };
}

function handleLabOrdersGet(role, actionUrl) {
  return (req, res) => {
    const statusFilter = String(req.query.status || '').trim();
    let orders = db.labOrders.map((o) => {
      const doc = db.doctors.find((d) => Number(d.id) === Number(o.doctorId));
      return { ...o, doctorName: doc ? doc.doctorName : 'Doctor' };
    });
    if (role === 'doctor') {
      orders = orders.filter((o) => Number(o.doctorId) === Number(req.session.userId));
    }
    if (statusFilter) orders = orders.filter((o) => o.status === statusFilter);
    orders.sort((a, b) => b.id - a.id);
    res.render('shared/lab-orders', {
      role,
      actionUrl,
      orders,
      users: db.users,
      doctors: db.doctors,
      statusFilter
    });
  };
}

function handleLabOrdersPost(role, redirectTo) {
  return (req, res) => {
    const action = String(req.body.action || 'create');
    if (action === 'complete') {
      const id = Number(req.body.id);
      const order = db.labOrders.find((o) => Number(o.id) === id);
      const resultSummary = String(req.body.resultSummary || '').trim();
      if (order && resultSummary) {
        order.resultSummary = resultSummary;
        order.status = 'Completed';
        order.completedAt = nowStr().slice(0, 16);
        logAudit(role, req.session.userId, 'lab_order_completed', 'lab_order', id, `${order.testName} completed`, req.ip);
        notify('patient', order.patientUserId, 'Lab result ready', `${order.testName} result has been published.`);
        flash(req, 'success', res.locals.lang === 'pt' ? 'Laudo registrado e liberado.' : 'Lab result published.');
      }
      return res.redirect(redirectTo);
    }

    const patientUserId = Number(req.body.patientUserId);
    const patient = db.users.find((u) => Number(u.id) === patientUserId);
    const doctorId = role === 'doctor' ? req.session.userId : Number(req.body.doctorId || 1);
    const testName = String(req.body.testName || '').trim();
    const category = String(req.body.category || 'Laboratory').trim();
    if (patient && testName) {
      const id = nextId('labOrders');
      db.labOrders.unshift({
        id,
        patientUserId,
        patientName: patient.fullName,
        doctorId,
        testName,
        category,
        status: 'In Analysis',
        resultSummary: res.locals.lang === 'pt' ? 'Aguardando conclusão laboratorial' : 'Pending laboratory report',
        orderedAt: nowStr().slice(0, 16),
        completedAt: null
      });
      logAudit(role, req.session.userId, 'lab_order_created', 'lab_order', id, `${testName} for ${patient.fullName}`, req.ip);
      flash(req, 'success', res.locals.lang === 'pt' ? 'Solicitação de exame registrada.' : 'Lab exam requested.');
    }
    res.redirect(redirectTo);
  };
}

app.get('/hms/doctor/triage.php', requireRole('doctor', '/hms/doctor/index.php'), handleTriageGet('doctor', '/hms/doctor/triage.php'));
app.post('/hms/doctor/triage.php', requireRole('doctor', '/hms/doctor/index.php'), handleTriagePost('doctor', '/hms/doctor/triage.php'));
app.get('/hms/doctor/beds.php', requireRole('doctor', '/hms/doctor/index.php'), handleBedsGet('doctor', '/hms/doctor/beds.php'));
app.post('/hms/doctor/beds.php', requireRole('doctor', '/hms/doctor/index.php'), handleBedsPost('doctor', '/hms/doctor/beds.php'));
app.get('/hms/doctor/lab-orders.php', requireRole('doctor', '/hms/doctor/index.php'), handleLabOrdersGet('doctor', '/hms/doctor/lab-orders.php'));
app.post('/hms/doctor/lab-orders.php', requireRole('doctor', '/hms/doctor/index.php'), handleLabOrdersPost('doctor', '/hms/doctor/lab-orders.php'));

app.get('/hms/doctor/logout.php', (req, res) => {
  req.session.destroy(() => res.redirect('/hms/doctor/index.php'));
});

// ---------- Admin Portal ----------
app.get(['/hms/admin', '/hms/admin/', '/hms/admin/index.php'], (req, res) => {
  if (req.session?.role === 'admin') return res.redirect('/hms/admin/dashboard.php');
  renderUnifiedAuth(req, res, 'login', 'admin');
});

app.post('/hms/admin/index.php', (req, res) => performAdminLogin(req, res, '/hms/admin/index.php'));

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
      newQueries: db.contactQueries.filter((q) => q.IsRead == null).length,
      availableBeds: db.beds.filter((b) => b.status === 'Available').length,
      totalBeds: db.beds.length,
      triageWaiting: db.triageQueue.filter((t) => t.status === 'Waiting').length,
      lowStockMeds: db.pharmacyStock.filter((m) => m.stock <= m.minStock).length,
      unpaidInvoices: db.invoices.filter((i) => i.status === 'Unpaid').length
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

// Admin new hospital operations routes
app.get('/hms/admin/triage.php', requireRole('admin', '/hms/admin/index.php'), handleTriageGet('admin', '/hms/admin/triage.php'));
app.post('/hms/admin/triage.php', requireRole('admin', '/hms/admin/index.php'), handleTriagePost('admin', '/hms/admin/triage.php'));
app.get('/hms/admin/beds.php', requireRole('admin', '/hms/admin/index.php'), handleBedsGet('admin', '/hms/admin/beds.php'));
app.post('/hms/admin/beds.php', requireRole('admin', '/hms/admin/index.php'), handleBedsPost('admin', '/hms/admin/beds.php'));
app.get('/hms/admin/lab-orders.php', requireRole('admin', '/hms/admin/index.php'), handleLabOrdersGet('admin', '/hms/admin/lab-orders.php'));
app.post('/hms/admin/lab-orders.php', requireRole('admin', '/hms/admin/index.php'), handleLabOrdersPost('admin', '/hms/admin/lab-orders.php'));

app.get('/hms/admin/pharmacy.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const items = db.pharmacyStock.slice().sort((a, b) => (a.stock <= a.minStock ? -1 : 1) || a.id - b.id);
  res.render('admin/pharmacy', {
    items,
    lowStockCount: items.filter((m) => m.stock <= m.minStock).length
  });
});

app.post('/hms/admin/pharmacy.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const action = String(req.body.action || 'create');
  if (action === 'adjust') {
    const id = Number(req.body.id);
    const delta = Number(req.body.delta || 0);
    const item = db.pharmacyStock.find((m) => Number(m.id) === id);
    if (item && Number.isFinite(delta)) {
      item.stock = Math.max(0, item.stock + delta);
      logAudit('admin', req.session.userId, 'pharmacy_stock_adjusted', 'pharmacy', id, `${item.name}: ${delta >= 0 ? '+' : ''}${delta} -> ${item.stock}`, req.ip);
      flash(req, 'success', res.locals.lang === 'pt' ? 'Estoque atualizado.' : 'Pharmacy inventory updated.');
    }
    return res.redirect('/hms/admin/pharmacy.php');
  }
  const name = String(req.body.name || '').trim();
  const category = String(req.body.category || '').trim();
  const unit = String(req.body.unit || 'Unidades / Units').trim();
  const stock = Math.max(0, Number(req.body.stock || 0));
  const minStock = Math.max(0, Number(req.body.minStock || 20));
  const batch = String(req.body.batch || '').trim();
  const expiresAt = String(req.body.expiresAt || '').trim();
  if (name) {
    const id = nextId('pharmacyStock');
    db.pharmacyStock.push({ id, name, category, unit, stock, minStock, batch, expiresAt });
    logAudit('admin', req.session.userId, 'pharmacy_item_added', 'pharmacy', id, `${name} (${stock})`, req.ip);
    flash(req, 'success', res.locals.lang === 'pt' ? 'Medicamento cadastrado no estoque.' : 'Medication added to stock.');
  }
  res.redirect('/hms/admin/pharmacy.php');
});

app.get('/hms/admin/billing.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const statusFilter = String(req.query.status || '').trim();
  let invoices = db.invoices.slice();
  if (statusFilter) invoices = invoices.filter((i) => i.status === statusFilter);
  invoices.sort((a, b) => b.id - a.id);
  const totalPaid = db.invoices.filter((i) => i.status === 'Paid').reduce((sum, i) => sum + Number(i.amount || 0), 0);
  const totalUnpaid = db.invoices.filter((i) => i.status === 'Unpaid').reduce((sum, i) => sum + Number(i.amount || 0), 0);
  res.render('admin/billing', {
    invoices,
    statusFilter,
    users: db.users,
    appointments: db.appointments.map(enrichAppointment),
    totalPaid,
    totalUnpaid
  });
});

app.post('/hms/admin/billing.php', requireRole('admin', '/hms/admin/index.php'), (req, res) => {
  const action = String(req.body.action || 'create');
  if (action === 'mark_paid') {
    const id = Number(req.body.id);
    const inv = db.invoices.find((i) => Number(i.id) === id);
    if (inv) {
      inv.status = 'Paid';
      inv.paidAt = todayStr();
      logAudit('admin', req.session.userId, 'invoice_paid', 'invoice', id, `Invoice #${id} marked Paid`, req.ip);
      flash(req, 'success', res.locals.lang === 'pt' ? 'Guia marcada como paga.' : 'Invoice marked as paid.');
    }
    return res.redirect('/hms/admin/billing.php');
  }
  const patientUserId = Number(req.body.patientUserId);
  const patient = db.users.find((u) => Number(u.id) === patientUserId);
  const appointmentId = Number(req.body.appointmentId || 0) || null;
  const description = String(req.body.description || '').trim();
  const amount = Math.max(0, Number(req.body.amount || 0));
  const method = String(req.body.method || 'PIX').trim();
  if (patient && description && amount > 0) {
    const id = nextId('invoices');
    db.invoices.unshift({
      id,
      appointmentId,
      patientUserId,
      patientName: patient.fullName,
      description,
      amount,
      method,
      status: 'Unpaid',
      issuedAt: todayStr(),
      paidAt: null
    });
    logAudit('admin', req.session.userId, 'invoice_created', 'invoice', id, `${patient.fullName} - ${amount}`, req.ip);
    notify('patient', patientUserId, 'New hospital invoice', `${description} (#${id})`);
    flash(req, 'success', res.locals.lang === 'pt' ? 'Guia de faturamento emitida.' : 'Invoice issued.');
  }
  res.redirect('/hms/admin/billing.php');
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
