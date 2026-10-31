-- Keep public terms aligned with the active member-only product. This is text-only and non-destructive.
UPDATE content
SET
  body_ar=replace(
    replace(
      body_ar,
      'حفظ المسودة أو رفع ملف أو إنشاء موقع بالنيابة لا ينشره تلقائياً؛',
      'حفظ المسودة أو رفع ملف لا ينشره تلقائياً؛'
    ),
    'إذا كانت خدمة التحويل البنكي مفعلة، تظهر تعليمات الدفع داخل طلب اشتراك مصادق عليه فقط. يبقى الإيصال خاصاً، ولا تتفعل الاستحقاقات بمجرد رفعه بل بعد تحقق واعتماد مخول. نقاط الوسط رصيد خدمات غير نقدي داخل المنصة، وليست مالاً إلكترونياً ولا يمكن سحبها نقداً.',
    'نقاط التميز المهني رصيد خدمات غير نقدي داخل المنصة، وليست مالاً إلكترونياً ولا يمكن سحبها نقداً.'
  ),
  body_en=replace(
    replace(
      body_en,
      'Saving a draft, uploading a file, or creating a site on behalf of another person does not publish it automatically.',
      'Saving a draft or uploading a file does not publish it automatically.'
    ),
    'If bank-transfer intake is enabled, payment instructions appear only inside an authenticated subscription request. A receipt remains private and does not activate an entitlement by itself; authorized verification and approval are required. Mid Points are non-cash service credits inside the platform. They are not electronic money and cannot be withdrawn for cash.',
    'Professional Excellence Points are non-cash service credits inside the platform. They are not electronic money and cannot be withdrawn for cash.'
  ),
  updated_at=strftime('%s','now')
WHERE slug='terms';
