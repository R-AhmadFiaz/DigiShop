export const subscriptionPayment = Object.freeze({
  monthlyPrice: 8000,
  currency: "PKR",
  durationDays: 30,
  bankName: "Meezan Bank",
  accountTitle: "RANA AHMAD FIAZ",
  accountNumber: "00300111791703",
  whatsappNumber: "+923004061677",
  qrAsset: "/subscription-payment-qr.jpg",
});

export const paymentPrice = () =>
  subscriptionPayment.currency +
  " " +
  subscriptionPayment.monthlyPrice.toLocaleString("en-PK");

export function paymentProofLink() {
  const number = subscriptionPayment.whatsappNumber.replace(/\D/g, "");
  const message =
    "Hello, I have paid " +
    paymentPrice() +
    " for my shop subscription. Shop Name:";
  return "https://wa.me/" + number + "?text=" + encodeURIComponent(message);
}
