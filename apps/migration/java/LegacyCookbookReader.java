import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

public final class LegacyCookbookReader {
    public static void main(String[] arguments) throws Exception {
        String url = requiredEnvironment("SOURCE_DB_URL");
        String username = requiredEnvironment("SOURCE_DB_USERNAME");
        String password = requiredEnvironment("SOURCE_DB_PASSWORD");

        try (Connection connection = DriverManager.getConnection(url, username, password)) {
            connection.setReadOnly(true);
            emitCategories(connection);
            emitUnits(connection);
            emitRecipes(connection);
            emitRecipeCategories(connection);
            emitSteps(connection);
            emitIngredientUsages(connection);
        }
    }

    private static void emitCategories(Connection connection) throws SQLException {
        emitQuery(connection, "SELECT CAT_ID, CAT_NAME, CAT_PARENT FROM CATEGORIES ORDER BY CAT_ID", "category");
    }

    private static void emitUnits(Connection connection) throws SQLException {
        emitQuery(connection, "SELECT UOM_ID, UOM_NAME, UOM_DELETED FROM UOM ORDER BY UOM_ID", "unit");
    }

    private static void emitRecipes(Connection connection) throws SQLException {
        emitQuery(connection, "SELECT RECIPE_ID, RECIPE_NAME, RECIPE_DESCRIPTION, RECIPE_THUMBNAIL FROM RECIPES ORDER BY RECIPE_ID", "recipe");
    }

    private static void emitRecipeCategories(Connection connection) throws SQLException {
        emitQuery(connection, "SELECT RC_ID, RC_RECIPE, RC_CATEGORY FROM RECIPE_CAT ORDER BY RC_ID", "recipeCategory");
    }

    private static void emitSteps(Connection connection) throws SQLException {
        emitQuery(connection, "SELECT STEP_ID, STEP_RECIPE, STEP_DESCRIPTION, STEP_ORDER FROM STEPS ORDER BY STEP_RECIPE, STEP_ORDER, STEP_ID", "step");
    }

    private static void emitIngredientUsages(Connection connection) throws SQLException {
        emitQuery(connection, "SELECT SI_ID, SI_STEP, SI_NAME, SI_UOM, SI_VALUE, SI_ORDER FROM STEP_INGREDIENT ORDER BY SI_STEP, SI_ORDER, SI_ID", "ingredientUsage");
    }

    private static void emitQuery(Connection connection, String sql, String type) throws SQLException {
        try (Statement statement = connection.createStatement(); ResultSet rows = statement.executeQuery(sql)) {
            int columnCount = rows.getMetaData().getColumnCount();
            while (rows.next()) {
                StringBuilder output = new StringBuilder();
                output.append("{\"type\":");
                appendJsonString(output, type);
                for (int index = 1; index <= columnCount; index += 1) {
                    output.append(',');
                    appendJsonString(output, rows.getMetaData().getColumnLabel(index).toLowerCase());
                    output.append(':');
                    Object value = rows.getObject(index);
                    if (value == null) {
                        output.append("null");
                    } else if (value instanceof Number || value instanceof Boolean) {
                        output.append(value);
                    } else {
                        appendJsonString(output, rows.getString(index));
                    }
                }
                output.append('}');
                System.out.println(output);
            }
        }
    }

    private static void appendJsonString(StringBuilder output, String value) {
        output.append('"');
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            switch (character) {
                case '"' -> output.append("\\\"");
                case '\\' -> output.append("\\\\");
                case '\b' -> output.append("\\b");
                case '\f' -> output.append("\\f");
                case '\n' -> output.append("\\n");
                case '\r' -> output.append("\\r");
                case '\t' -> output.append("\\t");
                default -> {
                    if (character < 0x20) output.append(String.format("\\u%04x", (int) character));
                    else output.append(character);
                }
            }
        }
        output.append('"');
    }

    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException(name + " must be configured.");
        return value;
    }
}
