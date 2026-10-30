import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Firebase web configuration for the existing DonorGram project.
// These values identify the web app; access is controlled by Firebase Auth
// and Firestore Security Rules, not by hiding the browser API key.
const firebaseConfig = {
  apiKey: "AIzaSyA2CuM61jyNiMcXstm_aUsIOwabfiTkKuo",
  authDomain: "donor-fd6ea.firebaseapp.com",
  databaseURL: "https://donor-fd6ea-default-rtdb.firebaseio.com",
  projectId: "donor-fd6ea",
  storageBucket: "donor-fd6ea.firebasestorage.app",
  messagingSenderId: "825423285184",
  appId: "1:825423285184:web:77f0160f05609e81381625",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const firebaseReady = true;
export const auth = getAuth(app);
export const db = getFirestore(app);
