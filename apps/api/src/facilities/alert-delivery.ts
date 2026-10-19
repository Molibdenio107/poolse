import { Logger } from '@nestjs/common';
import { labAlertEmail } from '../notifications/lab-alert-email.js';
import { sendEmail, type Email } from '../notifications/notifier.js';
import { waterAlertEmail } from '../notifications/water-alert-email.js';
import { findWaterAlertNotice, markAlertSent } from './analyses.repository.js';
import { findLabAlertNotice, markLabAlertSent } from './lab-results.repository.js';

/**
 * Sending a water alert (4.2) and a lab-result alert (POOLSE-72), by the alert's
 * id — moved out of their controllers by POOLSE-86 so the hourly retry calls the
 * same function the request does. Each renders from the row, writes to every
 * recipient separately (staff addresses are not shown to each other, and one
 * refused address must not take the rest down), and stamps who was written to
 * and whether anything left. Never throws.
 */

const logger = new Logger('AlertDelivery');

export async function deliverWaterAlert(
  organizationId: string,
  alertId: string,
  send: (email: Email) => Promise<boolean> = sendEmail,
): Promise<boolean> {
  try {
    const notice = await findWaterAlertNotice(organizationId, alertId);
    if (notice === null) return false;
    // A reading corrected back inside its band before a retry has nothing left to
    // say, and an empty alert would be worse than none (sweep 19-10b).
    if (notice.excursions.length === 0) return false;

    let delivered = false;
    for (const to of notice.recipients) {
      const sent = await send(
        waterAlertEmail({
          to,
          organizationName: notice.organizationName,
          facilityName: notice.facilityName,
          poolName: notice.poolName,
          takenAt: notice.takenAt,
          timezone: notice.facilityTimezone,
          excursions: notice.excursions,
          locale: notice.organizationLocale,
        }),
      );
      // One address that went through is enough to call the alert delivered;
      // the recipient list is recorded whole either way.
      delivered = delivered || sent;
    }
    await markAlertSent(organizationId, alertId, notice.recipients, delivered);
    return delivered;
  } catch (error) {
    logger.warn(`Could not send water alert ${alertId}: ${String(error)}`);
    return false;
  }
}

export async function deliverLabAlert(
  organizationId: string,
  alertId: string,
  send: (email: Email) => Promise<boolean> = sendEmail,
): Promise<boolean> {
  try {
    const notice = await findLabAlertNotice(organizationId, alertId);
    if (notice === null) return false;
    if (notice.grading.failures.length === 0) return false;
    let delivered = false;
    for (const to of notice.recipients) {
      const sent = await send(
        labAlertEmail({
          to,
          organizationName: notice.organizationName,
          facilityName: notice.facilityName,
          poolName: notice.poolName,
          sampledAt: notice.sampledAt,
          timezone: notice.facilityTimezone,
          laboratory: notice.laboratory,
          failures: notice.grading.failures,
          locale: notice.organizationLocale,
        }),
      );
      delivered = delivered || sent;
    }
    await markLabAlertSent(organizationId, alertId, notice.recipients, delivered);
    return delivered;
  } catch (error) {
    logger.warn(`Could not send lab alert ${alertId}: ${String(error)}`);
    return false;
  }
}
