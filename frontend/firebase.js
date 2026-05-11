import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA_qL7fXWl5J1-cIlCrPzffOVknIwxeptc",
  authDomain: "sd5-project-77355.firebaseapp.com",
  projectId: "sd5-project-77355",
  storageBucket: "sd5-project-77355.firebasestorage.app",
  messagingSenderId: "319688735002",
  appId: "1:319688735002:web:1dc151bd0b44e8a22f94a3"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);  // ✅Only export once
export const db = getFirestore(app);