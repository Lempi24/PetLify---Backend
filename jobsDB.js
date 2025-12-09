import cron from "node-cron";
import pool from "./database.js";

cron.schedule("0 0 * * *", async () => {
    try {
        await pool.query(`
            DELETE FROM reports.lost_reports 
            WHERE lost_date < NOW() - INTERVAL '30 days'
        `);

        await pool.query(`
            DELETE FROM reports.found_reports 
            WHERE found_date < NOW() - INTERVAL '30 days'
        `);

        console.log("Stare zgłoszenia usunięte.");
    } catch (err) {
        console.error("CRON error:", err);
    }
});
