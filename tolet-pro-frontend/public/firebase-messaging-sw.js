/* Legacy Firebase Messaging worker.
 *
 * New FCM tokens are registered against /service-worker.js at root scope.
 * This file remains for older browser registrations that were previously
 * scoped to /firebase-push/.
 */

importScripts('/call-notification-sw.js');
