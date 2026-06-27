const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://tolet-app-2:h3kzHGf8mjNHcErH@to-let-pro.kbuu4s7.mongodb.net/toletpro?retryWrites=true&w=majority')
  .then(async () => {
    try {
      const svc = require('./services/notification.service');
      console.log('emitting to admins...');
      await svc.emitToAdmins({
        type: 'support_ticket',
        title: 'Test Ticket',
        body: 'This is a test ticket',
        data: { ticketId: '12345', path: '/admin/support' }
      });
      console.log('done emitting');
    } catch (e) {
      console.error(e);
    }
    process.exit(0);
  });
