document.getElementById("go").addEventListener("click", async () => {
  const msg = document.getElementById("msg");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach((t) => t.stop());
    msg.textContent = "Camera allowed. You can close this tab and press Start camera in the side panel.";
  } catch (e) {
    msg.textContent = "Still blocked: " + e.message + " (check chrome://settings/content/camera)";
  }
});
