# تحقق إعدادات بريد الإطلاق

تمت مراجعة إعدادات النطاق `ksa.men` في Resend في 31 أكتوبر 2026. حالة الإرسال مفعلة، وتتبع فتح الرسائل والنقرات معطّل على النطاق؛ لذلك لا يلزم أي تعديل إضافي في Resend. توضح وثائق Resend أن التتبع معطّل افتراضياً، ولا يعمل ما لم يكن تتبع الفتح أو النقر مفعلاً مع نطاق تتبع تم التحقق منه [1].

تدعم Cloudflare Email Service ربطًا من نوع `send_email` لعامل Workers. واجهة الربط تدعم إرسال الرسائل المنظمة وتبقي القناة الثانوية منفصلة عن مسار القرار المعتمد [2]. يلزم أن ينتمي عنوان المرسل إلى نطاق مُضمَّن في Email Service، وأن يكون DNS لدى Cloudflare [3]. أُضيف `ksa.men` إلى الخدمة في 31 أكتوبر 2026، وعادت حالة سجلاتها `ready` بلا تعارض. الإرسال إلى مستلمين متغيرين من Cloudflare يتطلب Workers Paid؛ يبقى Resend المسار الأول، وتعمل القناة الثانوية عند تحقق أهلية الإرسال في الحساب [4].

**References**

[1]: https://resend.com/docs/dashboard/domains/tracking "Open and Click Tracking"
[2]: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/ "Email Sending Workers API"
[3]: https://developers.cloudflare.com/email-service/get-started/send-emails/ "Send emails"
[4]: https://developers.cloudflare.com/email-service/platform/pricing/ "Email Service pricing"
