import { sumar, multiplicar } from "./sumador";

const first = document.querySelector("#primer-numero");
const second = document.querySelector("#segundo-numero");
const form = document.querySelector("#sumar-form");
const div = document.querySelector("#resultado-div");

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const firstNumber = Number.parseInt(first.value);
  const secondNumber = Number.parseInt(second.value);

  // Verificamos cuál botón envió el formulario
  const accion = event.submitter.value;

  if (accion === "Multiplicar") {
    div.innerHTML = "<p>Resultado Multiplicación: " + multiplicar(firstNumber, secondNumber) + "</p>";
  } else {
    div.innerHTML = "<p>Resultado Suma: " + sumar(firstNumber, secondNumber) + "</p>";
  }
});